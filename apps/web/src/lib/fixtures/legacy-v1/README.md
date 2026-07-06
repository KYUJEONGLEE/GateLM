# Legacy v1 Fixture Snapshots

이 폴더는 Web Console fallback/demo 화면이 사용하는 legacy v1 fixture snapshot을 보관한다.

원본은 `docs/archive/v1.0.0/fixtures/`에서 온 historical data다. Web runtime code가 archive 문서 경로를 직접 import하지 않도록 앱 내부 compatibility data로 복사했다.

이 데이터는 현재 Gateway 계약의 Source Of Truth가 아니다. 현재 계약 판단은 `specs/gateway/v2.0.0/contracts.md`, schema, fixture를 따른다.
