# LLMOps Gateway

LLMOps Gateway는 여러 LLM Provider API를 하나의 Gateway에서 관리하기 위한 프로젝트입니다.

현재 초기 세팅은 다음 내용을 포함합니다.

* 로컬 개발용 PostgreSQL / Redis 환경
* Docker Compose 기반 인프라 실행
* GitHub Actions 기반 초기 CI
* Pull Request 기반 협업 규칙
* main 브랜치 보호 규칙

---

## 1. 사전 준비

팀원은 로컬 PC에 아래 프로그램을 설치해야 합니다.

* Git
* Docker Desktop
* VS Code 또는 원하는 IDE

Docker Desktop 설치 후에는 Docker가 정상 실행되는지 확인합니다.

```powershell
docker --version
docker compose version
```

---

## 2. Repository Clone

각자 작업할 위치에서 아래 명령어를 실행합니다.

```powershell
git clone <레포지토리_URL>
cd LLMOps-Gateway
```

예시:

```powershell
git clone https://github.com/KYUJEONGLEE/LLMOps-Gateway.git
cd LLMOps-Gateway
```

현재 브랜치가 `main`인지 확인합니다.

```powershell
git branch
```

정상이라면 아래처럼 표시됩니다.

```txt
* main
```

---

## 3. 환경변수 파일 생성

실제 환경변수 파일인 `.env`는 Git에 올리지 않습니다.

처음 clone 받은 팀원은 `.env.example`을 복사해서 `.env`를 만듭니다.

```powershell
Copy-Item .env.example .env
```

`.env` 파일은 개인 로컬 환경에서만 사용합니다.

절대 Git에 커밋하지 않습니다.

---

## 4. 로컬 인프라 실행

이 프로젝트는 로컬 개발을 위해 PostgreSQL과 Redis를 Docker Compose로 실행합니다.

레포 루트에서 아래 명령어를 실행합니다.

```powershell
docker compose up -d
```

실행 상태 확인:

```powershell
docker compose ps
```

정상이라면 `db`, `redis` 컨테이너가 실행 중이어야 합니다.

---

## 5. Docker Compose 주요 명령어

### 실행

```powershell
docker compose up -d
```

PostgreSQL과 Redis를 백그라운드에서 실행합니다.

### 상태 확인

```powershell
docker compose ps
```

현재 실행 중인 컨테이너 상태를 확인합니다.

### 로그 확인

```powershell
docker compose logs -f
```

전체 컨테이너 로그를 실시간으로 확인합니다.

특정 서비스 로그만 보고 싶으면 아래처럼 실행합니다.

```powershell
docker compose logs -f db
docker compose logs -f redis
```

### 중지

```powershell
docker compose down
```

컨테이너를 중지하고 제거합니다.

단, DB 데이터가 저장된 volume은 삭제하지 않습니다.

### DB까지 완전 초기화

```powershell
docker compose down -v
docker compose up -d
```

주의: `docker compose down -v`는 PostgreSQL 데이터 volume까지 삭제합니다.
로컬 DB 데이터가 전부 초기화되므로, DB가 꼬였을 때만 사용합니다.

---

## 6. 로컬 DB / Redis 관련 주의사항

각 팀원은 자기 PC에서 별도의 PostgreSQL과 Redis를 실행합니다.

즉, 팀원마다 로컬 DB 데이터는 다를 수 있습니다.

이것은 정상입니다.

공유해야 하는 것은 실제 DB 데이터가 아니라 다음 항목입니다.

* DB schema
* migration 파일
* seed 데이터
* docker-compose.yml
* .env.example

Redis는 캐시, rate limit counter, 임시 상태 저장 등에 사용될 예정입니다.
Redis 데이터는 로컬마다 달라도 문제 없습니다.

---

## 7. Git 작업 규칙

`main` 브랜치에 직접 push하지 않습니다.

모든 작업은 feature 브랜치를 만든 뒤 Pull Request로 진행합니다.

### 작업 시작 전

```powershell
git checkout main
git pull origin main
```

### 새 브랜치 생성

```powershell
git checkout -b feature/작업이름
```

예시:

```powershell
git checkout -b feature/gateway-basic
git checkout -b feature/control-plane-api
git checkout -b feature/dashboard-ui
git checkout -b fix/docker-compose
```

### 작업 후 커밋

```powershell
git status
git add .
git commit -m "작업 내용"
```

예시:

```powershell
git commit -m "Gateway 기본 서버 설정"
git commit -m "Docker Compose 설정 수정"
git commit -m "대시보드 초기 화면 추가"
```

### 원격 브랜치 push

```powershell
git push origin feature/작업이름
```

그 후 GitHub에서 Pull Request를 생성합니다.

---

## 8. Pull Request 규칙

Pull Request는 아래 조건을 만족해야 merge할 수 있습니다.

* CI 통과
* 최소 1명 이상 리뷰 승인
* main 브랜치와 충돌 없음

PR을 만들 때는 다음 내용을 적습니다.

```md
## 작업 내용

- 무엇을 변경했는지 작성

## 확인한 내용

- 로컬 실행 여부
- 테스트 여부
- Docker Compose 영향 여부

## 참고사항

- 리뷰어가 알아야 할 내용 작성
```

---

## 9. GitHub Actions CI

현재 GitHub Actions는 Pull Request 또는 main push 시 실행됩니다.

현재 CI는 다음 내용을 검사합니다.

* `.env` 파일 커밋 여부
* `.pem`, `.key` 등 secret 파일 커밋 여부
* credentials 관련 파일 커밋 여부

CI가 실패하면 Pull Request를 merge하면 안 됩니다.

---

## 10. 절대 커밋하면 안 되는 파일

아래 파일은 절대 Git에 올리지 않습니다.

```txt
.env
.env.local
.env.development
*.pem
*.key
*.p12
*.pfx
credentials.json
service-account.json
```

환경변수 예시는 `.env.example`에만 작성합니다.

실제 API Key, DB 비밀번호, SSH Key는 `.env` 또는 GitHub Secrets에만 저장합니다.

---

## 11. 현재 기본 포트

로컬 개발 환경에서 사용하는 기본 포트는 다음과 같습니다.

| 서비스        |   포트 |
| ---------- | ---: |
| PostgreSQL | 5432 |
| Redis      | 6379 |

PostgreSQL 접속 정보는 기본적으로 아래와 같습니다.

```txt
host: localhost
port: 5432
database: llmops_db
user: admin
password: adminpassword
```

Redis 접속 정보는 아래와 같습니다.

```txt
host: localhost
port: 6379
```

---

## 12. 자주 쓰는 명령어 요약

```powershell
# 최신 main 받기
git checkout main
git pull origin main

# 새 작업 브랜치 생성
git checkout -b feature/작업이름

# 로컬 인프라 실행
docker compose up -d

# 컨테이너 상태 확인
docker compose ps

# 로그 확인
docker compose logs -f

# 컨테이너 중지
docker compose down

# 로컬 DB 초기화
docker compose down -v
docker compose up -d
```
