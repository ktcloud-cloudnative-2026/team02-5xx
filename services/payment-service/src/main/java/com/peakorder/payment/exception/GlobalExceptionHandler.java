package com.peakorder.payment.exception;

import com.peakorder.payment.dto.ApiResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.resource.NoResourceFoundException;

@RestControllerAdvice
public class GlobalExceptionHandler {

  private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

  @ExceptionHandler(BusinessException.class)
  public ResponseEntity<ApiResponse<Void>> handleBusiness(BusinessException e) {
    ErrorCode code = e.errorCode();
    return ResponseEntity.status(code.status()).body(ApiResponse.fail(code.name(), code.message()));
  }

  /** 요청 값 검증 실패. 첫 번째 필드 오류의 한글 메시지(DTO에 적은 문구)를 그대로 돌려준다. */
  @ExceptionHandler(MethodArgumentNotValidException.class)
  public ResponseEntity<ApiResponse<Void>> handleValidation(MethodArgumentNotValidException e) {
    String message =
        e.getBindingResult().getFieldErrors().stream()
            .findFirst()
            .map(f -> f.getDefaultMessage())
            .filter(m -> m != null && !m.isBlank())
            .orElse(ErrorCode.INVALID_REQUEST.message());
    return ResponseEntity.status(ErrorCode.INVALID_REQUEST.status())
        .body(ApiResponse.fail(ErrorCode.INVALID_REQUEST.name(), message));
  }

  @ExceptionHandler(HttpMessageNotReadableException.class)
  public ResponseEntity<ApiResponse<Void>> handleUnreadable(HttpMessageNotReadableException e) {
    return ResponseEntity.status(ErrorCode.INVALID_REQUEST.status())
        .body(
            ApiResponse.fail(
                ErrorCode.INVALID_REQUEST.name(), ErrorCode.INVALID_REQUEST.message()));
  }

  @ExceptionHandler(NoResourceFoundException.class)
  public ResponseEntity<ApiResponse<Void>> handleNotFound(NoResourceFoundException e) {
    return ResponseEntity.status(HttpStatus.NOT_FOUND)
        .body(ApiResponse.fail("NOT_FOUND", "요청한 리소스를 찾을 수 없습니다."));
  }

  @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
  public ResponseEntity<ApiResponse<Void>> handleMethodNotAllowed(
      HttpRequestMethodNotSupportedException e) {
    return ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED)
        .body(ApiResponse.fail("METHOD_NOT_ALLOWED", "지원하지 않는 HTTP 메서드입니다."));
  }

  @ExceptionHandler(Exception.class)
  public ResponseEntity<ApiResponse<Void>> handleUnexpected(Exception e) {
    log.error("처리되지 않은 예외", e);
    ErrorCode code = ErrorCode.INTERNAL_ERROR;
    return ResponseEntity.status(code.status()).body(ApiResponse.fail(code.name(), code.message()));
  }
}
