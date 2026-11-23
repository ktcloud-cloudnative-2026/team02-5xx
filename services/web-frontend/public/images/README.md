# Peak Order 정적 이미지 저장소

고정 이미지는 React/Vite의 `public/images/` 아래에서 관리합니다. Vite 빌드 시 파일이 `dist/images/`에 복사되므로 별도 이미지 서비스, DB 이미지 바이너리, PVC, S3/MinIO 없이 기존 Frontend 배포 경로를 사용합니다.

## 경로

| 경로                            | 저장 대상                                                | 현재 상태                            |
| ------------------------------- | -------------------------------------------------------- | ------------------------------------ |
| `brand/`                        | 확정 로고, 파비콘                                        | 실제 로고 원본 미제공, 안내문만 있음 |
| `menus/`                        | 배포에 포함할 고정 메뉴 사진                             | 실제 음식 사진 미제공, 안내문만 있음 |
| `defaults/menu-placeholder.svg` | 메뉴 이미지가 없거나 로딩 실패할 때 표시하는 공통 이미지 | 포함됨                               |

DB의 `menus.image_url`은 실제 웹에서 접근 가능한 **루트 상대 경로**를 저장합니다. 예: `/images/menus/classic-burger.webp`. API는 기존 `imageUrl` 문자열 또는 NULL을 유지하며, 경로를 프론트엔드가 같은 origin으로 요청합니다. 없는 파일 경로를 DB에 먼저 등록하지 않습니다.

## 표시 규칙

- Menu API가 `imageUrl: null`을 반환하면 `/images/defaults/menu-placeholder.svg`를 보여줍니다.
- 제공된 이미지 URL이 로딩 실패해도 동일한 기본 이미지로 대체합니다.
- 외부 이미지/URL이 올바른지 백엔드에서 검증하는 기능, 파일 업로드 API와 사용자 프로필 업로드는 이번 프로젝트에 추가하지 않습니다.
- 로고와 파비콘은 확정된 원본을 받기 전까지 UI에 임의 이미지로 대체하지 않습니다.
- 이미지의 파일명이나 URL을 바꾸면 연결된 DB 데이터를 함께 정리해야 합니다.
- 고정 사진을 바꾸면 새 Frontend 이미지를 빌드·배포해야 합니다. Menu DB 업데이트만으로 새 파일이 생기지는 않습니다.

## 검증

프론트엔드 빌드 완료 후 `dist/images/defaults/menu-placeholder.svg`가 존재하는지 확인합니다.

배포 후 외부 노출 경로가 확정되면 아래 URL 형태로 **실제 HTTP 200**을 확인합니다.

```text
https://peakorder.jpexstudio.com/images/defaults/menu-placeholder.svg
https://peakorder.jpexstudio.com/images/menus/classic-burger.webp
```

두 번째 URL은 `classic-burger.webp`를 실제로 추가한 뒤에만 확인합니다. 현재 첫 배포는 Gateway·HTTPRoute와 이미지 빌드의 실제 반영 여부를 별도 검증해야 합니다.

메뉴 시드 PR #218의 `image_url` 값은 NULL을 유지합니다. 승인된 메뉴 사진이 들어오면 별도 변경으로 정적 파일을 추가하고, 참조 URL을 그때 등록합니다.

## 향후 범위

사용자가 업로드하는 파일은 추후 별도 스토리지와 업로드 권한·검증·교체·삭제 정책을 설계합니다. 현재 정적 이미지 관리 작업에는 포함하지 않습니다.
