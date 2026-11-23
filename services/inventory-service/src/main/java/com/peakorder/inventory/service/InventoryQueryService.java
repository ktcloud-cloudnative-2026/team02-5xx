package com.peakorder.inventory.service;

import com.peakorder.inventory.dto.AvailabilityResponse;
import com.peakorder.inventory.entity.Inventory;
import com.peakorder.inventory.exception.BusinessException;
import com.peakorder.inventory.exception.ErrorCode;
import com.peakorder.inventory.repository.InventoryRepository;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class InventoryQueryService {

  private static final int MAX_MENU_IDS = 100;

  private final InventoryRepository inventoryRepository;

  public InventoryQueryService(InventoryRepository inventoryRepository) {
    this.inventoryRepository = inventoryRepository;
  }

  @Transactional(readOnly = true)
  public List<AvailabilityResponse> availability(String menuIds) {
    // 1. "1,2,3"을 숫자 목록으로 바꾼다. 잘못된 값이면 400
    List<Long> ids = parseMenuIds(menuIds);

    // 2. 재고를 한 번에 가져와 메뉴 번호로 찾기 쉽게 정리한다
    Map<Long, Inventory> byMenuId =
        inventoryRepository.findByMenuIdIn(ids).stream()
            .collect(Collectors.toMap(Inventory::getMenuId, Function.identity()));

    // 3. 요청한 순서대로 답한다. 연결된 재고가 없으면 주문 불가
    return ids.stream()
        .map(
            id -> {
              Inventory inventory = byMenuId.get(id);
              if (inventory == null) {
                return new AvailabilityResponse(id, false, 0);
              }
              int available = inventory.getAvailableQty();
              return new AvailabilityResponse(id, available > 0, available);
            })
        .toList();
  }

  private List<Long> parseMenuIds(String raw) {
    if (raw == null || raw.isBlank()) {
      throw new BusinessException(ErrorCode.INVALID_REQUEST);
    }
    List<Long> ids;
    try {
      ids = Arrays.stream(raw.split(",")).map(String::trim).map(Long::valueOf).distinct().toList();
    } catch (NumberFormatException e) {
      throw new BusinessException(ErrorCode.INVALID_REQUEST);
    }
    if (ids.size() > MAX_MENU_IDS || ids.stream().anyMatch(id -> id <= 0)) {
      throw new BusinessException(ErrorCode.INVALID_REQUEST);
    }
    return ids;
  }
}
