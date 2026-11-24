// Educational demo policy. Keep the server's two AUTH_*_VERSION settings in sync.
// Policy text/version are managed here, independently from form and transport code.
export const registrationTerms = Object.freeze([
  Object.freeze({
    type: 'TERMS',
    version: 'demo-v1',
    title: '시연용 이용약관',
    text: `1. 프로젝트 목적
Peak Order는 교육·포트폴리오를 위한 음식 주문 시연 시스템입니다. 실제 음식점의 영업 서비스가 아니며 실제 음식 제공을 보장하지 않습니다.

2. 제공 기능
메뉴 조회, 고객 회원가입·로그인, 장바구니, 주문, 모의 결제 및 주문 내역 확인 기능을 시연합니다. 주문 취소는 서버가 허용하는 상태에서만 요청할 수 있습니다.

3. 모의 결제
이 시스템의 결제는 모의 결제입니다. 실제 금전 결제가 발생하지 않으며 실제 환불을 제공하지 않습니다. 실제 카드 정보나 금융 정보를 입력하지 마세요.

4. 시연 참여 시 주의
본인 소유의 시연용 이메일과 다른 서비스에서 사용하지 않는 비밀번호를 사용해 주세요. 실제 주소·전화번호·결제 정보 등 불필요한 개인정보를 입력하지 마세요. 다른 사람의 계정을 사용하거나 시스템의 정상 동작을 방해하지 마세요.

5. 시연 환경의 한계
교육·개발 과정에서 기능이 변경되거나 서비스가 중단되고 데이터가 초기화될 수 있습니다. 상용 서비스 수준의 가용성이나 운영 보안 기능을 보장하지 않습니다. 계정·정보 삭제와 관련한 요청은 프로젝트 담당자에게 별도로 문의해야 하며, 자동 삭제나 탈퇴 화면이 제공되는 것으로 안내하지 않습니다.

6. 적용 범위
이 약관은 Peak Order 시연 참여를 안내하기 위한 문서입니다. 실제 영업·금전 결제를 시작하는 경우에는 별도 정책과 검토가 필요합니다.`,
  }),
  Object.freeze({
    type: 'PRIVACY',
    version: 'demo-v1',
    title: '시연용 개인정보 처리방침',
    text: `1. 처리 목적과 필수 항목
Peak Order는 교육·시연용 계정 생성, 로그인 및 본인 주문 구분을 위해 이메일과 비밀번호를 입력받습니다. 필수 이용약관 및 개인정보 동의가 없으면 회원가입할 수 없습니다. 불필요한 실제 개인정보 대신 본인 소유의 시연용 이메일을 사용해 주세요.

2. Auth DB에 저장되는 정보
회원가입 시 사용자 ID, 이메일, 비밀번호 해시, 고객 권한(CUSTOMER), 계정 상태, 생성·수정 일시를 저장합니다. 동의 기록에는 사용자 ID, 약관 종류(TERMS·PRIVACY), 버전, 동의 여부 및 동의 일시가 저장됩니다.
현재 회원가입 화면은 이름·전화번호·닉네임을 수집하지 않습니다. Auth DB에 해당 선택 컬럼이 있더라도 이 가입 요청으로 값을 입력하지 않습니다.

3. 비밀번호와 로그인 정보
비밀번호는 Auth 서버에서 Argon2 해시로 변환해 저장하며 원문 비밀번호를 DB에 저장하지 않습니다. 로그인 시에는 세션 유지를 위한 refresh token의 해시, 사용자 연결 정보와 만료·폐기 등의 관리 정보가 Auth DB에서 처리됩니다. 회원가입 자체가 자동 로그인을 수행하지는 않습니다.

4. 보관 및 삭제의 한계
시연 데이터는 개발 환경에 보관되며 개발 과정에서 초기화될 수 있습니다. 정기적인 개인정보 자동 삭제, 사용자 직접 탈퇴·삭제 화면이나 확정된 보존 기간은 현재 구현되어 있지 않습니다. 삭제 관련 사항은 프로젝트 담당자에게 별도로 문의해 주세요.

5. 시연 환경 주의
실제 카드·금융 정보나 민감정보를 입력하지 마세요. 이 문서는 현재 시연 구현을 설명하며, 구현되지 않은 운영 보안·환불·자동 삭제 기능을 보장하지 않습니다. 상용 서비스 전환 시에는 개인정보 처리 범위와 정책을 다시 검토해야 합니다.`,
  }),
]);

export function termsReady(terms) {
  return (
    Array.isArray(terms) &&
    terms.length === 2 &&
    ['TERMS', 'PRIVACY'].every(
      (type) =>
        terms.filter(
          (item) =>
            item?.type === type &&
            typeof item.version === 'string' &&
            item.version.trim().length > 0 &&
            item.version.length <= 64 &&
            typeof item.title === 'string' &&
            item.title.trim() &&
            typeof item.text === 'string' &&
            item.text.trim(),
        ).length === 1,
    )
  );
}
