# Control Plane Account Recovery Contract Proposal

| Field | Value |
|---|---|
| Status | Proposed; 구현 PR과 함께 검토하며 병합 전에는 active 계약이 아님 |
| Scope | Dashboard와 active Tenant Chat의 공통 local-password account recovery and password change |
| Baseline | `origin/dev @ 63734d195d03ad39fcbb72a40f1c4cc366b26efc` |
| Proposed at | 2026-07-23 |
| Event change | 없음 |
| Metrics change | 없음 |

## 1. Goals

- Dashboard와 active Tenant Chat에서 가입·초대 이메일을 로그인 ID로 안내한다.
- 초기 테스트용 Application Chat은 구현 범위에서 제외한다.
- 계정 존재 여부를 노출하지 않는 비밀번호 재설정 요청을 제공한다.
- 일회용·단기 만료 토큰으로 새 비밀번호를 설정한다.
- 로그인한 local-password 사용자가 현재 비밀번호를 확인한 뒤 비밀번호를 변경한다.
- 새로 설정되는 모든 비밀번호에 동일한 정책을 적용한다.
- 비밀번호 재설정 또는 변경 후 기존 Control Plane과 Tenant Chat 세션을 폐기한다.

## 2. Account Identifier Boundary

GateLM local account의 로그인 ID는 가입 이메일이다.

- 별도의 사용자명, 전화번호, 보조 이메일로 계정을 검색하는 API를 만들지 않는다.
- 이름이나 Tenant 정보로 가입 이메일을 조회하거나 부분 마스킹된 계정 후보를 반환하지 않는다.
- 이메일을 기억하지 못하는 사용자는 가입·초대 메일을 확인하거나 Tenant 관리자에게 문의하도록 UI에서 안내한다.
- 비밀번호 재설정 요청은 입력 이메일에 해당하는 계정의 존재 여부와 관계없이 같은 HTTP 상태와 응답 body를 반환한다.

## 3. Password Policy

새로 생성하거나 변경하는 비밀번호에는 다음 정책을 적용한다.

- 최소 8자, 최대 15자
- 영문 대문자, 영문 소문자, 숫자, ASCII 특수문자를 각각 1개 이상 포함
- 모든 공백 문자 금지
- 정책 미충족 거부 응답 code: `WEAK_PASSWORD`

적용 경로:

- Web Console 회원가입
- Tenant Chat 신규·회수 가능 계정의 초대 수락
- 비밀번호 재설정 확인
- 로그인 사용자 비밀번호 변경

기존 비밀번호를 이용한 로그인에는 새 최소 길이를 소급 적용하지 않는다. 기존 사용자가 로그인할 수 있어야 하며, 다음 변경 시점에 새 정책을 적용한다.

현재 `scrypt-v1` hash parameter 변경은 이 제안의 범위가 아니다. work factor 상향은 운영 환경 benchmark와 기존 hash 재처리 전략을 포함한 별도 보안 변경으로 검토한다.

## 4. API Contract

Dashboard는 아래 `/api/auth/**` route를 사용한다. active Tenant Chat은 같은 의미를 `chat-web -> chat-api -> Control Plane private identity` 체인으로 제공하며 browser route는 `/api/tenant-chat/auth/password-reset/request`, `/password-reset/confirm`, `/password/change`다.

### `POST /api/auth/password-reset/request`

인증이 필요하지 않다.

Request:

```json
{
  "email": "owner@example.com"
}
```

Response:

- HTTP `202 Accepted`
- 계정 없음, Google-only 계정, 미인증 계정, 요청 제한 도달을 구분하지 않는다.

```json
{
  "data": {
    "accepted": true
  }
}
```

Eligible account의 시간당 토큰 생성은 최대 5개다. 메일 전송 실패도 공개 응답을 바꾸지 않는다.

### `POST /api/auth/password-reset/confirm`

Request:

```json
{
  "token": "<opaque token>",
  "newPassword": "<new password>"
}
```

Success:

- HTTP `200 OK`
- 토큰을 single-use로 소비한다.
- 같은 사용자의 다른 미사용 reset token을 모두 소비한다.
- 기존 Control Plane `AuthSession`, Tenant Chat refresh token, Tenant Chat session을 폐기한다.
- 자동 로그인하지 않으며 인증 쿠키를 삭제한다.

```json
{
  "data": {
    "passwordReset": true
  }
}
```

유효하지 않거나 만료·소비된 토큰은 `INVALID_PASSWORD_RESET_TOKEN`으로 거부한다.

### `POST /api/auth/password/change`

`full` Control Plane session이 필요하다.

Request:

```json
{
  "currentPassword": "<current password>",
  "newPassword": "<new password>"
}
```

Success:

- HTTP `200 OK`
- 현재 비밀번호를 검증한다.
- 기존 비밀번호와 같은 값은 `PASSWORD_UNCHANGED`로 거부한다.
- 기존 Control Plane과 Tenant Chat 세션을 모두 폐기한다.
- 요청한 브라우저의 auth cookie도 삭제하고 새 비밀번호로 다시 로그인하게 한다.

Google-only 계정은 `PASSWORD_NOT_CONFIGURED`로 거부한다.

### `GET /api/auth/me`

공개 사용자 표현에 다음 boolean field를 추가한다.

```json
{
  "hasLocalPassword": true
}
```

Web Console은 이 값이 `true`일 때만 비밀번호 변경 action을 제공한다.

## 5. Reset Token Storage And Delivery

`password_reset_tokens` table:

- `id`
- `userId`
- `tokenHash` unique
- `expiresAt`
- `consumedAt`
- `createdAt`

규칙:

- 원본 token은 DB에 저장하지 않는다.
- token은 암호학적 난수로 만들고 `hashSecret` 결과만 저장한다.
- 유효 시간은 생성 후 30분이다.
- Dashboard reset URL은 `/auth/reset-password#token=...`, Tenant Chat reset URL은 `/reset-password#token=...` 형식으로 각 서비스 origin에서 전달한다.
- fragment를 사용해 브라우저가 초기 HTTP 요청과 일반 server access log에 token을 보내지 않게 한다.
- reset 화면은 token을 읽은 즉시 주소 표시줄에서 fragment를 제거한다.

## 6. Security And Forbidden Data

- 계정 존재 여부를 응답 status, body, error message로 공개하지 않는다.
- raw reset token, raw password, password hash, 이메일 주소를 application log 또는 metric label에 기록하지 않는다.
- SMTP 오류 log는 고정 문구만 사용하며 provider raw error를 포함하지 않는다.
- 비밀번호 재설정·변경 완료 메일에는 비밀번호나 token을 포함하지 않는다.
- 비밀번호 변경은 현재 비밀번호 확인과 active full-session 확인을 모두 요구한다.
- reset token 소비와 비밀번호 갱신·세션 폐기는 하나의 DB transaction에서 수행한다.
- reset과 change는 `actorAuthzVersion`을 증가시켜 기존 Tenant Chat access JWT도 무효화한다.

## 7. UI Contract

- 로그인 화면에서 “로그인 ID는 가입 이메일”임을 설명한다.
- 비밀번호 재설정 요청 결과는 계정 존재 여부와 무관한 공통 안내를 표시한다.
- 회원가입, reset, change, Tenant Chat 신규 초대 화면은 8~15자 조합 정책과 비밀번호 확인 입력을 제공한다.
- Dashboard와 Tenant Chat의 비밀번호 입력은 보기·숨기기 제어를 제공한다. 새 비밀번호와 확인값이 유효하면 초록색 체크를 표시한다.
- 비밀번호 변경 화면은 새 비밀번호가 현재 비밀번호와 같으면 제출 전에 다른 비밀번호를 입력하라는 안내를 표시하며, 서버도 `PASSWORD_UNCHANGED`로 거부한다.
- Google-only 계정에는 local password가 없음을 프로필 메뉴에서 안내한다.
- active Tenant Chat 로그인과 계정 화면에도 동일한 ID 안내, reset, change 동선을 제공한다.

## 8. Verification

- 8자·15자 경계, 대문자·소문자·숫자·특수문자 누락, 공백 포함 거부 unit test
- 현재 비밀번호 재사용 거부와 기존 계정 로그인 호환성 test
- unknown email과 eligible email의 reset request 응답 동일성 test
- token hash-only storage, single-use, expiry boundary test
- reset 후 기존 session과 기존 password 거부 test
- authenticated change 후 current session과 other session이 모두 revoke되는 test
- Control Plane, Web Console, Tenant Chat API/Web typecheck
- Prisma schema generation and migration review
