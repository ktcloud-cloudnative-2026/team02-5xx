package com.peakorder.order.controller;

import com.peakorder.order.dto.ApiResponse;
import com.peakorder.order.dto.CreateOrderRequest;
import com.peakorder.order.dto.OrderDetailResponse;
import com.peakorder.order.dto.OrderListResponse;
import com.peakorder.order.service.OrderService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * 고객 주문 API.
 *
 * <p>TODO(인증): 사용자 식별 방식(Gateway JWT 전달 / 서비스 직접 검증)이 정해지기 전까지 임시로 {@code X-User-Id} 헤더를 사용한다. 이
 * 헤더는 위조할 수 있으므로 인증 방식이 확정되면 반드시 교체한다.
 */
@RestController
@RequestMapping("/api/v1/orders")
@Tag(name = "Order")
public class OrderController {

  private static final String USER_ID_HEADER = "X-User-Id";

  private final OrderService orderService;

  public OrderController(OrderService orderService) {
    this.orderService = orderService;
  }

  @PostMapping
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(summary = "임시 주문 생성 (OR-01)")
  public ApiResponse<OrderDetailResponse> create(
      @RequestHeader(USER_ID_HEADER) Long userId, @Valid @RequestBody CreateOrderRequest request) {
    return ApiResponse.ok(orderService.createOrder(userId, request), "임시 주문이 생성되었습니다.");
  }

  @GetMapping
  @Operation(summary = "본인 주문 목록 조회 (OR-03)")
  public ApiResponse<OrderListResponse> list(
      @RequestHeader(USER_ID_HEADER) Long userId,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size) {
    return ApiResponse.ok(orderService.listOrders(userId, page, size));
  }

  @GetMapping("/{orderId}")
  @Operation(summary = "주문 상세 조회 (OR-04)")
  public ApiResponse<OrderDetailResponse> get(
      @RequestHeader(USER_ID_HEADER) Long userId, @PathVariable Long orderId) {
    return ApiResponse.ok(orderService.getOrder(userId, orderId));
  }
}
