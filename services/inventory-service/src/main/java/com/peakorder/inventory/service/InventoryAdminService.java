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
import java.util.Objects;
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

  private Inventory lockStockItem(Long stockItemId) {
    return inventoryRepository
        .findByIdForUpdate(stockItemId)
        .orElseThrow(() -> new BusinessException(ErrorCode.INVENTORY_NOT_FOUND));
  }
}
