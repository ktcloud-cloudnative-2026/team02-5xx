package com.peakorder.order.service;

import com.peakorder.order.client.CookingClient;
import com.peakorder.order.client.CookingClient.CancelResult;
import com.peakorder.order.client.InventoryClient;
import com.peakorder.order.client.InventoryClient.HoldRelease;
import com.peakorder.order.client.InventoryClient.RestoreResult;
import com.peakorder.order.client.PaymentClient;
import com.peakorder.order.dto.OrderDetailResponse;
import com.peakorder.order.entity.OrderStatus;
import com.peakorder.order.exception.BusinessException;
import com.peakorder.order.exception.ErrorCode;
import com.peakorder.order.service.OrderTxService.CancelTarget;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * OR-05 주문 취소.
 *
 * <ul>
 *   <li>결제 전(CREATED): 재고 확보만 해제(II-03)하고 CANCELED. 환불 없음.
 *   <li>확정된 주문(PAID 이후): Cooking이 최종 판단(CI-03). 취소가 확정되면 먼저 CANCELED로 바꾸고, 재고 복원(II-04)과 환불(PI-03)을
 *       한다. 복원·환불이 실패해도 주문은 CANCELED로 두고 끝나지 않은 단계를 기록해 재시도로 이어서 처리한다(임의로 성공 처리하지 않는다).
 * </ul>
 *
 * <p>결제와 같은 처리 독점(토큰)을 잡고 진행하므로 같은 주문의 결제·취소·후속 처리가 동시에 돌지 않는다. 외부 호출 직전마다 독점을 연장하며 확인하고, 잃었으면 아무것도
 * 하지 않고 멈춘다. 외부 서비스 호출 중에는 DB 트랜잭션을 잡지 않는다.
 */
@Service
public class OrderCancelService {

  static final String CUSTOMER_CANCEL = "CUSTOMER_CANCEL";

  private static final Logger log = LoggerFactory.getLogger(OrderCancelService.class);

  private final OrderTxService txService;
  private final CookingClient cookingClient;
  private final InventoryClient inventoryClient;
  private final PaymentClient paymentClient;

  public OrderCancelService(
      OrderTxService txService,
      CookingClient cookingClient,
      InventoryClient inventoryClient,
      PaymentClient paymentClient) {
    this.txService = txService;
    this.cookingClient = cookingClient;
    this.inventoryClient = inventoryClient;
    this.paymentClient = paymentClient;
  }

  public OrderDetailResponse cancelOrder(Long userId, Long orderId) {
    CancelTarget first = txService.findCancelTarget(userId, orderId);
    rejectIfNotCancelable(first);
    if (first.status() == OrderStatus.CANCELED && !followUpRemaining(first)) {
      return first.detail();
    }

    Optional<UUID> acquired = txService.tryAcquireCancelLock(orderId);
    if (acquired.isEmpty()) {
      // 다른 요청이 처리 중이거나 그 사이 끝났다. 끝났으면 그 결과를, 아니면 처리 중임을 알린다.
      CancelTarget current = txService.findCancelTarget(userId, orderId);
      rejectIfNotCancelable(current);
      if (current.status() == OrderStatus.CANCELED && !followUpRemaining(current)) {
        return current.detail();
      }
      throw new BusinessException(ErrorCode.ORDER_PAY_IN_PROGRESS);
    }
    UUID lock = acquired.get();
    try {
      // 독점을 잡기 전에 읽은 값은 오래됐을 수 있으므로 독점을 잡은 뒤 다시 읽는다.
      CancelTarget target = txService.findCancelTarget(userId, orderId);
      rejectIfNotCancelable(target);
      return switch (target.status()) {
        case CANCELED -> finishFollowUps(orderId, lock, target);
        case CREATED -> cancelBeforePayment(orderId, lock, target);
        default -> cancelConfirmed(orderId, lock);
      };
    } finally {
      releaseQuietly(orderId, lock);
    }
  }

  /**
   * 취소 후속 처리(재고 복원·환불)가 남은 주문을 이어서 처리한다. 스케줄러가 주기적으로 호출한다.
   *
   * @return 이번에 후속 처리를 끝낸 주문 수
   */
  public int retryPendingFollowUps(int graceSec, int limit) {
    List<Long> ids = txService.findCancelFollowUpIds(graceSec, limit);
    int completed = 0;
    for (Long orderId : ids) {
      Optional<UUID> acquired = txService.tryAcquireCancelLock(orderId);
      if (acquired.isEmpty()) {
        continue; // 다른 요청이 처리 중
      }
      UUID lock = acquired.get();
      try {
        CancelTarget target = txService.findCancelTargetById(orderId);
        if (target.status() == OrderStatus.CANCELED && followUpRemaining(target)) {
          finishFollowUps(orderId, lock, target);
          if (!followUpRemaining(txService.findCancelTargetById(orderId))) {
            completed++;
          }
        }
      } catch (RuntimeException e) {
        log.warn("취소 후속 처리 재시도 실패, 다음 주기에 다시 시도합니다 orderId={}", orderId, e);
      } finally {
        releaseQuietly(orderId, lock);
      }
    }
    return completed;
  }

  /**
   * Cooking 응답을 모른 채 남은 취소 요청을 다시 확인한다(CI-03은 멱등). 스케줄러가 주기적으로 호출한다. Cooking이 취소를 받아들이면 주문을
   * CANCELED로 바꾸고 후속 처리를 이어가며, 조리 시작·완료 등으로 거절하면 취소 요청 기록을 지운다. 여전히 응답을 모르면 다음 주기에 다시 확인한다.
   *
   * @return 이번에 취소를 확정한 주문 수
   */
  public int retryUnresolvedCancelRequests(int graceSec, int limit) {
    List<Long> ids = txService.findCancelRequestIds(graceSec, limit);
    int resolved = 0;
    for (Long orderId : ids) {
      Optional<UUID> acquired = txService.tryAcquireCancelLock(orderId);
      if (acquired.isEmpty()) {
        continue; // 다른 요청이 처리 중
      }
      UUID lock = acquired.get();
      try {
        CancelTarget target = txService.findCancelTargetById(orderId);
        if (target.status() == OrderStatus.CANCELED || target.status() == OrderStatus.COMPLETED) {
          continue; // 이미 다른 경로로 정리됨
        }
        cancelConfirmed(orderId, lock);
        resolved++;
      } catch (BusinessException e) {
        // 조리 시작·완료 등 거절, 또는 아직 응답을 모름. 거절은 기록이 지워져 더 이상 확인하지 않는다.
        log.info("취소 요청 재확인 결과 취소하지 못했습니다 orderId={} code={}", orderId, e.errorCode());
      } catch (RuntimeException e) {
        log.warn("취소 요청 재확인 실패, 다음 주기에 다시 시도합니다 orderId={}", orderId, e);
      } finally {
        releaseQuietly(orderId, lock);
      }
    }
    return resolved;
  }

  /** 결제 전 주문 취소: 재고 확보만 해제한다. 결제를 요청한 적이 있으면 결제가 됐을 수 있어 취소하지 않는다. */
  private OrderDetailResponse cancelBeforePayment(Long orderId, UUID lock, CancelTarget target) {
    if (target.paymentRequestedAt() != null) {
      throw new BusinessException(ErrorCode.ORDER_PAYMENT_PENDING);
    }
    if (target.holdId() != null) {
      keepLockOrStop(orderId, lock);
      HoldRelease released = inventoryClient.releaseHold(target.holdId());
      if (released == HoldRelease.ALREADY_CONFIRMED) {
        // 결제 기록이 없는데 재고가 확정됐다. 임의로 취소하지 않고 수동 확인에 맡긴다.
        log.error(
            "결제 전 주문의 재고 확보가 이미 확정돼 있어 취소하지 않습니다. 수동 확인 필요 orderId={} holdId={}",
            orderId,
            target.holdId());
        throw new BusinessException(ErrorCode.ORDER_NOT_CANCELABLE);
      }
    }
    if (!txService.markCanceled(orderId, lock, CUSTOMER_CANCEL)) {
      throw new BusinessException(ErrorCode.ORDER_PAY_IN_PROGRESS);
    }
    return latest(orderId);
  }

  /**
   * 확정된 주문 취소: Cooking이 취소를 받아들일 때만 CANCELED로 바꾸고 후속 처리를 이어간다. Cooking을 호출하기 직전에 취소 요청 시각을 기록해 두므로,
   * 응답을 모른 채(타임아웃 등) 끝나도 {@link #retryUnresolvedCancelRequests}가 CI-03을 다시 호출해 확정한다(Cooking 취소는
   * 멱등).
   */
  private OrderDetailResponse cancelConfirmed(Long orderId, UUID lock) {
    keepLockOrStop(orderId, lock);
    if (!txService.markCancelRequested(orderId, lock)) {
      throw new BusinessException(ErrorCode.ORDER_PAY_IN_PROGRESS);
    }
    CancelResult result = askCooking(orderId, lock);
    switch (result) {
      case ALREADY_STARTED -> throw new BusinessException(ErrorCode.COOKING_ALREADY_STARTED);
      case ALREADY_DONE -> throw new BusinessException(ErrorCode.COOKING_ALREADY_DONE);
      case TICKET_NOT_FOUND -> throw new BusinessException(ErrorCode.COOKING_ORDER_PENDING);
      case CANCELED -> {
        // 취소가 확정됐다. 아래 저장에 실패해도 Cooking 취소는 멱등이라 재확인으로 이어진다.
      }
    }
    if (!txService.markCanceled(orderId, lock, CUSTOMER_CANCEL)) {
      throw new BusinessException(ErrorCode.ORDER_PAY_IN_PROGRESS);
    }
    return finishFollowUps(orderId, lock, txService.findCancelTargetById(orderId));
  }

  /**
   * Cooking에 취소를 요청한다. 취소 불가로 거절되거나(조리 시작·완료·접수 전) 계약과 다른 응답이면 재확인해도 소용없으므로 취소 요청 기록을 지운다. 결과를 모르는
   * 경우 (COOKING_SERVICE_UNAVAILABLE)만 기록을 남겨 스케줄러가 다시 확인하게 한다.
   */
  private CancelResult askCooking(Long orderId, UUID lock) {
    CancelResult result;
    try {
      result = cookingClient.cancel(orderId);
    } catch (BusinessException e) {
      if (e.errorCode() != ErrorCode.COOKING_SERVICE_UNAVAILABLE) {
        log.error("Cooking 취소 응답이 계약과 다릅니다. 재확인하지 않습니다 orderId={} code={}", orderId, e.errorCode());
        clearCancelRequestedQuietly(orderId, lock);
      }
      throw e;
    }
    if (result != CancelResult.CANCELED) {
      clearCancelRequestedQuietly(orderId, lock);
    }
    return result;
  }

  private void clearCancelRequestedQuietly(Long orderId, UUID lock) {
    try {
      txService.clearCancelRequested(orderId, lock);
    } catch (RuntimeException e) {
      log.warn("취소 요청 기록을 지우지 못했습니다. 다음 확인에서 다시 판단합니다 orderId={}", orderId, e);
    }
  }

  /**
   * 재고 복원과 환불을 각각 시도한다. 한쪽이 실패해도 다른 쪽은 계속하고, 실패한 단계는 기록하지 않아 재시도 대상으로 남는다. 어느 경우에도 주문은 CANCELED다.
   */
  private OrderDetailResponse finishFollowUps(Long orderId, UUID lock, CancelTarget target) {
    if (target.stockRestoreRemaining()) {
      restoreStock(orderId, lock);
    }
    if (target.refundRemaining()) {
      refund(orderId, lock, target.paymentId());
    }
    return latest(orderId);
  }

  private void restoreStock(Long orderId, UUID lock) {
    try {
      keepLockOrStop(orderId, lock);
      RestoreResult restored = inventoryClient.restore(orderId);
      if (restored == RestoreResult.RESTORED) {
        txService.markStockRestored(orderId, lock);
      } else {
        log.error("재고를 복원할 수 없다는 응답입니다. 수동 확인 필요 orderId={}", orderId);
      }
    } catch (BusinessException e) {
      log.warn("취소 후 재고 복원 실패, 재시도 대상으로 남깁니다 orderId={} code={}", orderId, e.errorCode());
    } catch (RuntimeException e) {
      log.warn("취소 후 재고 복원 중 오류, 재시도 대상으로 남깁니다 orderId={}", orderId, e);
    }
  }

  private void refund(Long orderId, UUID lock, Long paymentId) {
    try {
      keepLockOrStop(orderId, lock);
      paymentClient.refund(paymentId);
      txService.markRefunded(orderId, lock);
    } catch (BusinessException e) {
      log.warn(
          "취소 후 환불 실패, 재시도 대상으로 남깁니다 orderId={} paymentId={} code={}",
          orderId,
          paymentId,
          e.errorCode());
    } catch (RuntimeException e) {
      log.warn("취소 후 환불 중 오류, 재시도 대상으로 남깁니다 orderId={} paymentId={}", orderId, paymentId, e);
    }
  }

  private OrderDetailResponse latest(Long orderId) {
    return txService.findCancelTargetById(orderId).detail();
  }

  private static boolean followUpRemaining(CancelTarget target) {
    return target.stockRestoreRemaining() || target.refundRemaining();
  }

  private static void rejectIfNotCancelable(CancelTarget target) {
    if (target.status() == OrderStatus.COMPLETED || target.status() == OrderStatus.FAILED) {
      throw new BusinessException(ErrorCode.ORDER_NOT_CANCELABLE);
    }
  }

  /** 외부 호출 전에 아직 내 독점인지 확인하며 연장한다. 잃었으면 아무것도 하지 않고 멈춘다. */
  private void keepLockOrStop(Long orderId, UUID lock) {
    if (!txService.renewPayLock(orderId, lock)) {
      throw new BusinessException(ErrorCode.ORDER_PAY_IN_PROGRESS);
    }
  }

  private void releaseQuietly(Long orderId, UUID lock) {
    try {
      txService.releasePayLock(orderId, lock);
    } catch (RuntimeException e) {
      log.warn("처리 독점을 놓지 못했습니다. 만료되면 풀립니다. orderId={}", orderId, e);
    }
  }
}
