# GitHub 사용 가이드

[← README](../README.md)

## 처음 한 번

1. 초대 메일에서 Join을 눌러 조직에 들어갑니다.
2. 저장소를 받고 이름과 이메일을 설정합니다. 이메일은 GitHub 계정에 등록된 것이어야 커밋이 본인 기여로 잡힙니다.

```bash
git clone https://github.com/ktcloud-cloudnative-2026/team02-5xx.git
cd team02-5xx
git config user.name "이름"
git config user.email "GitHub 계정 이메일"
```

## 팀 첫날 설정

main에 직접 push하지 않고 Issue → 별도 브랜치 → PR로 작업합니다. 확정 규칙은 [CLAUDE.md](../CLAUDE.md#6-github-협업)를 따릅니다. 일반 변경은 리뷰 선택이며 중요 변경은 작성자 외 팀원 1명 승인이 필수입니다. 아래는 초기 설정 확인 항목입니다.

- [ ] README 맨 위 `<팀 이름> — <서비스 이름>`과 한 줄 소개를 바꿈
- [ ] [역할](roles.md)에 팀원, GitHub 아이디, 맡은 서비스, 공통 영역 적기
- [ ] [CODEOWNERS](../.github/CODEOWNERS)에 서비스 폴더별 담당자 적기
- [ ] Projects 보드 만들기: 조직 Projects → New project → Board → Status에 In Review 추가(Todo · In Progress · In Review · Done) → 필드 "서비스" 추가 → 이 저장소 Projects 탭에서 Link a project → README 링크 표에 주소 적기
- [ ] [팀 운영 약속](team.md) 채우기
- [ ] 일감 양식으로 첫 이슈 만들기: [기획서](plan.md) 작성

채울 순서는 [기획서](plan.md) → [요구사항](requirements.md) → [아키텍처](architecture.md) → [기술 스택](tech-stack.md) → [API 명세](api/)입니다.

## 작업 순서

이슈 하나에 브랜치 하나, PR 하나로 작업합니다.

1. Issues → New issue → 일감 양식으로 이슈를 만들고, 보드에서 In Progress로 옮깁니다.
2. 최신 main에서 브랜치를 만듭니다.

```bash
git switch main
git pull
git switch -c feat/12-seat-list
```

3. 작업하고 커밋합니다.

```bash
git add .
git commit -m "feat: 좌석 조회 API (#12)"
```

4. 브랜치를 올립니다.

```bash
git push -u origin feat/12-seat-list
```

5. 저장소 화면의 Compare & pull request 버튼으로 PR을 엽니다. 본문에 `Closes #12`를 적습니다.
6. GitHub Actions 검사 통과와 필요한 리뷰 승인을 확인한 뒤 Squash and merge 합니다. AI는 사용자 승인 없이 병합하지 않습니다. 이슈는 닫히며 보드 상태는 Projects 설정에 따라 갱신합니다.
7. main으로 돌아와 정리합니다.

```bash
git switch main
git pull
git branch -D feat/12-seat-list
```

## 리뷰

1. PR의 Files changed 탭에서 바뀐 내용을 봅니다.
2. 궁금한 줄에 댓글을 답니다.
3. Review changes에서 Approve 또는 Request changes를 고릅니다. 일반 변경은 리뷰 선택이며, DB·서비스 간 계약·인증·결제/재고 정합성·공통 인프라·여러 서비스의 공통 코드 변경은 작성자 외 팀원 1명 승인이 필수입니다.

## 자주 생기는 일

- main에 바로 push하면 거절됩니다. 브랜치를 만들어 PR로 올립니다.
- PR에 충돌이 나면 내 브랜치에서 `git pull origin main`을 하고, 충돌 난 파일을 고친 뒤 `git add .`, `git commit`, `git push` 합니다.
- 리뷰에서 수정 요청을 받으면 같은 브랜치에서 고치고 push 합니다. PR에 자동으로 반영됩니다.
- 비밀번호나 토큰을 커밋했다면 바로 팀과 강사에게 알리고 그 값을 바꿉니다. 커밋을 지워도 기록에 남습니다.

## 문서 작업

`docs/` 문서도 같은 순서(브랜치 → PR → 리뷰)로 고칩니다. 새 문서를 만들면 README 문서 표에 링크를 추가합니다.

규칙의 자세한 내용은 [공통 규칙](conventions.md)에 있습니다.
