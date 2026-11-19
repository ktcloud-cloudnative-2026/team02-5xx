package com.peakorder.order.service;

import com.peakorder.order.dto.StoreOperationResponse;
import com.peakorder.order.dto.UpdateStoreOperationRequest;
import com.peakorder.order.entity.StoreOperation;
import com.peakorder.order.exception.BusinessException;
import com.peakorder.order.exception.ErrorCode;
import com.peakorder.order.repository.StoreOperationRepository;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * OR-06·OR-07 영업·주문 접수 상태 조회·변경. 단일 매장이라 행은 항상 id = 1 한 건이다.
 *
 * <p>변경은 OR-01(주문 생성)이 다음 요청부터 바로 읽는다. 이미 만들어진 주문의 결제·조회·취소는 이 설정과 무관하다. 인증이 없어 "누가" 바꿨는지는 남기지 못하고
 * 변경 전후 값만 로그로 남긴다.
 */
@Service
public class StoreOperationService {

  private static final Logger log = LoggerFactory.getLogger(StoreOperationService.class);

  private final StoreOperationRepository storeRepository;
  private final Clock clock;

  public StoreOperationService(StoreOperationRepository storeRepository, Clock clock) {
    this.storeRepository = storeRepository;
    this.clock = clock;
  }

  @Transactional(readOnly = true)
  public StoreOperationResponse get() {
    return StoreOperationResponse.from(find());
  }

  @Transactional
  public StoreOperationResponse update(UpdateStoreOperationRequest request) {
    if (request == null || request.isEmpty()) {
      throw new BusinessException(ErrorCode.INVALID_REQUEST);
    }
    StoreOperation store =
        storeRepository
            .findWithLockById(StoreOperation.SINGLE_STORE_ID)
            .orElseThrow(() -> new BusinessException(ErrorCode.INTERNAL_ERROR));
    boolean wasOpen = store.isOpen();
    boolean wasAccepting = store.isAcceptingOrders();
    if (store.update(
        request.isOpen(),
        request.acceptingOrders(),
        OffsetDateTime.now(clock).truncatedTo(ChronoUnit.MICROS))) {
      log.info(
          "영업·접수 상태를 변경했습니다 isOpen {} -> {}, acceptingOrders {} -> {}",
          wasOpen,
          store.isOpen(),
          wasAccepting,
          store.isAcceptingOrders());
    }
    return StoreOperationResponse.from(store);
  }

  private StoreOperation find() {
    return storeRepository
        .findById(StoreOperation.SINGLE_STORE_ID)
        .orElseThrow(() -> new BusinessException(ErrorCode.INTERNAL_ERROR));
  }
}
