package com.peakorder.inventory.service;

import com.peakorder.inventory.client.MenuClient;
import com.peakorder.inventory.client.MenuClient.MenuExistence;
import com.peakorder.inventory.dto.MenuLinkRequest;
import com.peakorder.inventory.dto.StockItemCreateRequest;
import com.peakorder.inventory.dto.StockItemResponse;
import com.peakorder.inventory.dto.StockRestockRequest;
import com.peakorder.inventory.entity.Inventory;
import com.peakorder.inventory.exception.BusinessException;
import com.peakorder.inventory.exception.ErrorCode;
import com.peakorder.inventory.repository.InventoryRepository;
import com.peakorder.inventory.repository.InventoryReservationItemRepository;
import java.util.List;
import java.util.Objects;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class InventoryAdminService {

  private final InventoryRepository inventoryRepository;
  private final InventoryReservationItemRepository itemRepository;
  private final MenuClient menuClient;

  public InventoryAdminService(
      InventoryRepository inventoryRepository,
      InventoryReservationItemRepository itemRepository,
      MenuClient menuClient) {
    this.inventoryRepository = inventoryRepository;
    this.itemRepository = itemRepository;
    this.menuClient = menuClient;
  }

  @Transactional(readOnly = true)
  public List<StockItemResponse> list(boolean lowStockOnly) {
    return inventoryRepository.findByDeletedAtIsNullOrderByIdAsc().stream()
        .filter(inventory -> !lowStockOnly || inventory.isLowStock())
        .map(StockItemResponse::from)
        .toList();
  }

  @Transactional
  public StockItemResponse create(StockItemCreateRequest request) {
    Inventory saved =
        inventoryRepository.save(new Inventory(request.stockQty(), request.lowStockThreshold()));
    return StockItemResponse.from(saved);
  }

  @Transactional
  public StockItemResponse restock(Long stockItemId, StockRestockRequest request) {
    Inventory inventory = lockStockItem(stockItemId);
    inventory.addStock(request.quantity());
    return StockItemResponse.from(inventory);
  }

  @Transactional
  public StockItemResponse linkMenu(Long stockItemId, MenuLinkRequest request) {
    Long menuId = request.menuId();

    // 1. 새로 연결할 메뉴가 있으면 Menu에 먼저 확인한다 (자물쇠를 채우기 전에)
    if (menuId != null) {
      checkLinkable(menuId);
    }

    // 2. 재고를 잠그고 찾는다. 없으면 404
    Inventory inventory = lockStockItem(stockItemId);

    // 3. 이미 같은 메뉴와 연결돼 있으면 그대로 성공
    if (Objects.equals(inventory.getMenuId(), menuId)) {
      return StockItemResponse.from(inventory);
    }

    // 4. 지금 메뉴로 끝나지 않은 주문(RESERVED, 복원될 수 있는 CONFIRMED)이 있으면 바꿀 수 없다.
    //    II-04는 메뉴 번호로 재고를 찾으므로, 확정 후 연결이 바뀌면 다른 재고가 늘거나 복원이 실패한다.
    //    재고 행을 잠근 뒤 확인하므로 같은 재고로 새 확보(II-01)·복원(II-04)이 끼어들 수 없다.
    if (inventory.getMenuId() != null
        && itemRepository.existsHoldOrConfirmedForMenu(inventory.getMenuId())) {
      throw new BusinessException(ErrorCode.STOCK_ITEM_IN_USE);
    }

    // 5. 새 메뉴가 이미 다른 재고에 연결돼 있으면 안 된다
    if (menuId != null && inventoryRepository.findByMenuId(menuId).isPresent()) {
      throw new BusinessException(ErrorCode.MENU_ALREADY_LINKED);
    }

    // 6. 연결한다 (menuId가 null이면 연결 해제)
    inventory.linkMenu(menuId);

    // 7. 5단계 확인은 다른 재고 행을 잠그지 않아 동시 요청을 막지 못한다. 최종 판정은 menu_id UNIQUE가 하므로
    //    바로 반영해 보고, 위반이면 500 대신 409로 돌려준다. 연결 해제(null)는 UNIQUE와 무관하다.
    if (menuId != null) {
      try {
        inventoryRepository.flush();
      } catch (DataIntegrityViolationException e) {
        throw new BusinessException(ErrorCode.MENU_ALREADY_LINKED);
      }
    }
    return StockItemResponse.from(inventory);
  }

  @Transactional
  public StockItemResponse delete(Long stockItemId) {
    // 1. 재고를 잠그고 찾는다. 없거나 이미 삭제됐으면 404
    Inventory inventory = lockStockItem(stockItemId);

    // 2. 메뉴 연결 변경과 같은 이유로, 끝나지 않은 주문(RESERVED·CONFIRMED)이 남은 메뉴의 재고는 지울 수 없다.
    //    II-04는 메뉴 번호로 재고를 찾으므로 삭제(연결 해제) 후에는 복원할 곳이 없어진다.
    if (inventory.getMenuId() != null
        && itemRepository.existsHoldOrConfirmedForMenu(inventory.getMenuId())) {
      throw new BusinessException(ErrorCode.STOCK_ITEM_IN_USE);
    }

    // 3. 삭제 시각을 남기고 메뉴 연결을 푼다
    inventory.delete();
    return StockItemResponse.from(inventory);
  }

  private void checkLinkable(Long menuId) {
    MenuExistence menu = menuClient.checkExistence(menuId);
    if (!menu.exists()) {
      throw new BusinessException(ErrorCode.MENU_NOT_FOUND);
    }
    if ("HIDDEN".equals(menu.status())) {
      throw new BusinessException(ErrorCode.MENU_NOT_LINKABLE);
    }
  }

  // 삭제된 재고는 없는 것으로 본다 (IN-04·IN-05·IN-06 모두 404)
  private Inventory lockStockItem(Long stockItemId) {
    return inventoryRepository
        .findByIdForUpdate(stockItemId)
        .filter(inventory -> !inventory.isDeleted())
        .orElseThrow(() -> new BusinessException(ErrorCode.INVENTORY_NOT_FOUND));
  }
}
