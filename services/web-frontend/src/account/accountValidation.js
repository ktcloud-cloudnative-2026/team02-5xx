export const codePoints = (value) => Array.from(value).length;
export function nicknameError(value) {
  return !value.trim() || codePoints(value) > 50
    ? '닉네임은 공백만 사용할 수 없고 1~50자로 입력해 주세요.'
    : '';
}
export function passwordError(current, next, confirmation) {
  if (!current) return '현재 비밀번호를 입력해 주세요.';
  if (codePoints(next) < 12 || codePoints(next) > 64)
    return '새 비밀번호는 12~64자로 입력해 주세요.';
  if (next !== confirmation) return '새 비밀번호 확인이 일치하지 않아요.';
  return '';
}
export function accountError(error) {
  if (error.kind === 'account-retry')
    return '로그인을 다시 확인했어요. 입력한 내용을 확인하고 다시 저장해 주세요.';
  if (error.errorCode === 'CURRENT_PASSWORD_MISMATCH')
    return '현재 비밀번호가 일치하지 않아요.';
  if (error.status === 401) return '로그인이 만료됐어요. 다시 로그인해 주세요.';
  if (error.status === 403) return '회원정보를 변경할 권한이 없어요.';
  if (error.errorCode === 'INVALID_REQUEST')
    return '입력한 내용을 확인하고 다시 저장해 주세요.';
  if (error.kind === 'network')
    return '연결이 끊겼어요. 변경 여부를 확인한 뒤 다시 시도해 주세요.';
  return '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.';
}
