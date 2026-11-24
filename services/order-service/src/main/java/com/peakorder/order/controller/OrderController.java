package com.peakorder.order.controller;

import com.peakorder.order.config.CurrentUser;
import com.peakorder.order.config.UserRole;
import com.peakorder.order.dto.ApiResponse;
import com.peakorder.order.dto.CreateOrderRequest;
import com.peakorder.order.dto.OrderDetailResponse;
import com.peakorder.order.dto.OrderListResponse;
import com.peakorder.order.service.OrderCancelService;
import com.peakorder.order.service.OrderService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * 고객 주문 API.
 *
 * <p>사용자 식별은 Gateway가 검증된 JWT에서 꺼내 전달하는 {@code X-User-Id}·{@code X-User-Role} 헤더로 한다(#112). 두 헤더가
 * 없거나 형식이 틀리면 401 UNAUTHORIZED, 역할이 CUSTOMER가 아니면 403 FORBIDDEN이며(관리자 계정은 주문·결제를 할 수 없다), 다른 사용자의
 * 주문은 기존대로 404 ORDER_NOT_FOUND다. 이 헤더는 Gateway를 거칠 때만 믿을 수 있으므로 서비스를 Gateway 밖에 직접 노출하지 않는다.
 */
@RestController
@RequestMapping("/api/v1/orders")
@Tag(name = "Order")
public class OrderController {

  private final OrderService orderService;
  private final OrderCancelService orderCancelService;

  public OrderController(OrderService orderService, OrderCancelService orderCancelService) {
    this.orderService = orderService;
    this.orderCancelService = orderCancelService;
  }

  @PostMapping
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(summary = "임시 주문 생성 (OR-01)")
  public ApiResponse<OrderDetailResponse> create(
      @CurrentUser(UserRole.CUSTOMER) Long userId, @Valid @RequestBody CreateOrderRequest request) {
    return ApiResponse.ok(orderService.createOrder(userId, request), "임시 주문이 생성되었습니다.");
  }

  @PostMapping("/{orderId}/pay")
  @Operation(summary = "모의 결제 요청 및 주문 확정 (OR-02)")
  public ApiResponse<OrderDetailResponse> pay(
      @CurrentUser(UserRole.CUSTOMER) Long userId, @PathVariable Long orderId) {
    return ApiResponse.ok(orderService.payOrder(userId, orderId), "결제가 완료되었습니다.");
  }

  @PostMapping("/{orderId}/cancel")
  @Operation(summary = "주문 취소 (OR-05)")
  public ApiResponse<OrderDetailResponse> cancel(
      @CurrentUser(UserRole.CUSTOMER) Long userId, @PathVariable Long orderId) {
    return ApiResponse.ok(orderCancelService.cancelOrder(userId, orderId), "주문이 취소되었습니다.");
  }

  @GetMapping
  @Operation(summary = "본인 주문 목록 조회 (OR-03)")
  public ApiResponse<OrderListResponse> list(
      @CurrentUser(UserRole.CUSTOMER) Long userId,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size) {
    return ApiResponse.ok(orderService.listOrders(userId, page, size));
  }

  @GetMapping("/{orderId}")
  @Operation(summary = "주문 상세 조회 (OR-04)")
  public ApiResponse<OrderDetailResponse> get(
      @CurrentUser(UserRole.CUSTOMER) Long userId, @PathVariable Long orderId) {
    return ApiResponse.ok(orderService.getOrder(userId, orderId));
  }
}
