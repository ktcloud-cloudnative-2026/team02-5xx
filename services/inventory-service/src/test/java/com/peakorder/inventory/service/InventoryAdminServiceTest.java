package com.peakorder.inventory.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

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
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.test.util.ReflectionTestUtils;

class InventoryAdminServiceTest {

  private InventoryRepository inventoryRepository;
  private InventoryReservationItemRepository itemRepository;
  private MenuClient menuClient;
  private InventoryAdminService service;

  @BeforeEach
  void setUp() {
    inventoryRepository = mock(InventoryRepository.class);
    itemRepository = mock(InventoryReservationItemRepository.class);
    menuClient = mock(MenuClient.class);
    service = new InventoryAdminService(inventoryRepository, itemRepository, menuClient);
  }

  private Inventory stockItem(long id, int stockQty, int reservedQty) {
    Inventory inventory = new Inventory(stockQty, 2);
    ReflectionTestUtils.setField(inventory, "id", id);
    ReflectionTestUtils.setField(inventory, "reservedQty", reservedQty);
    return inventory;
  }

  private Inventory linkedStockItem(long id, long menuId) {
    Inventory inventory = stockItem(id, 10, 0);
    ReflectionTestUtils.setField(inventory, "menuId", menuId);
    return inventory;
  }

  // ===== IN-03 등록 =====

  @Test
  void create_saves_new_stock_item_without_menu() {
    when(inventoryRepository.save(any())).thenAnswer(call -> call.getArgument(0));

    StockItemResponse response = service.create(new StockItemCreateRequest(10, 2));

    assertThat(response.stockQty()).isEqualTo(10);
    assertThat(response.reservedQty()).isEqualTo(0);
    assertThat(response.menuId()).isNull();
  }

  // ===== IN-04 추가 =====

  @Test
  void restock_adds_quantity() {
    Inventory inventory = stockItem(1L, 3, 1);
    when(inventoryRepository.findByIdForUpdate(1L)).thenReturn(Optional.of(inventory));

    StockItemResponse response = service.restock(1L, new StockRestockRequest(10));

    assertThat(response.stockQty()).isEqualTo(13);
    assertThat(response.availableQty()).isEqualTo(12);
  }

  @Test
  void restock_throws_not_found_when_no_item() {
    when(inventoryRepository.findByIdForUpdate(99L)).thenReturn(Optional.empty());

    assertThatThrownBy(() -> service.restock(99L, new StockRestockRequest(10)))
        .isInstanceOf(BusinessException.class)
        .extracting("errorCode")
        .isEqualTo(ErrorCode.INVENTORY_NOT_FOUND);
  }

  // ===== IN-05 메뉴 연결 =====

  @Test
  void linkMenu_links_on_sale_menu() {
    when(menuClient.checkExistence(10L)).thenReturn(new MenuExistence(10L, true, "ON_SALE"));
    when(inventoryRepository.findByIdForUpdate(1L)).thenReturn(Optional.of(stockItem(1L, 10, 0)));
    when(inventoryRepository.findByMenuId(10L)).thenReturn(Optional.empty());

    StockItemResponse response = service.linkMenu(1L, new MenuLinkRequest(10L));

    assertThat(response.menuId()).isEqualTo(10L);
  }

  @Test
  void linkMenu_rejects_hidden_menu() {
    when(menuClient.checkExistence(10L)).thenReturn(new MenuExistence(10L, true, "HIDDEN"));

    assertThatThrownBy(() -> service.linkMenu(1L, new MenuLinkRequest(10L)))
        .isInstanceOf(BusinessException.class)
        .extracting("errorCode")
        .isEqualTo(ErrorCode.MENU_NOT_LINKABLE);
    verify(inventoryRepository, never()).findByIdForUpdate(any());
  }

  @Test
  void linkMenu_rejects_missing_menu() {
    when(menuClient.checkExistence(10L)).thenReturn(new MenuExistence(10L, false, null));

    assertThatThrownBy(() -> service.linkMenu(1L, new MenuLinkRequest(10L)))
        .isInstanceOf(BusinessException.class)
        .extracting("errorCode")
        .isEqualTo(ErrorCode.MENU_NOT_FOUND);
  }

  @Test
  void linkMenu_rejects_menu_linked_to_other_item() {
    when(menuClient.checkExistence(10L)).thenReturn(new MenuExistence(10L, true, "PAUSED"));
    when(inventoryRepository.findByIdForUpdate(1L)).thenReturn(Optional.of(stockItem(1L, 10, 0)));
    when(inventoryRepository.findByMenuId(10L)).thenReturn(Optional.of(linkedStockItem(2L, 10L)));

    assertThatThrownBy(() -> service.linkMenu(1L, new MenuLinkRequest(10L)))
        .isInstanceOf(BusinessException.class)
        .extracting("errorCode")
        .isEqualTo(ErrorCode.MENU_ALREADY_LINKED);
  }

  @Test
  void linkMenu_rejects_change_when_order_is_holding() {
    Inventory inventory = linkedStockItem(1L, 5L);
    when(menuClient.checkExistence(10L)).thenReturn(new MenuExistence(10L, true, "ON_SALE"));
    when(inventoryRepository.findByIdForUpdate(1L)).thenReturn(Optional.of(inventory));
    when(itemRepository.existsHoldOrConfirmedForMenu(5L)).thenReturn(true);

    assertThatThrownBy(() -> service.linkMenu(1L, new MenuLinkRequest(10L)))
        .isInstanceOf(BusinessException.class)
        .extracting("errorCode")
        .isEqualTo(ErrorCode.STOCK_ITEM_IN_USE);
    assertThat(inventory.getMenuId()).isEqualTo(5L);
  }

  @Test
  void linkMenu_keeps_existing_link_when_menu_service_down() {
    Inventory inventory = linkedStockItem(1L, 5L);
    when(menuClient.checkExistence(10L))
        .thenThrow(new BusinessException(ErrorCode.MENU_SERVICE_UNAVAILABLE));
    when(inventoryRepository.findByIdForUpdate(1L)).thenReturn(Optional.of(inventory));

    assertThatThrownBy(() -> service.linkMenu(1L, new MenuLinkRequest(10L)))
        .isInstanceOf(BusinessException.class)
        .extracting("errorCode")
        .isEqualTo(ErrorCode.MENU_SERVICE_UNAVAILABLE);
    assertThat(inventory.getMenuId()).isEqualTo(5L);
  }

  @Test
  void linkMenu_rejects_unlink_when_confirmed_order_can_be_restored() {
    Inventory inventory = linkedStockItem(1L, 5L);
    when(inventoryRepository.findByIdForUpdate(1L)).thenReturn(Optional.of(inventory));
    when(itemRepository.existsHoldOrConfirmedForMenu(5L)).thenReturn(true);

    assertThatThrownBy(() -> service.linkMenu(1L, new MenuLinkRequest(null)))
        .isInstanceOf(BusinessException.class)
        .extracting("errorCode")
        .isEqualTo(ErrorCode.STOCK_ITEM_IN_USE);
    assertThat(inventory.getMenuId()).isEqualTo(5L);
  }

  @Test
  void linkMenu_checks_orders_only_after_locking_stock_item() {
    when(menuClient.checkExistence(10L)).thenReturn(new MenuExistence(10L, true, "ON_SALE"));
    when(inventoryRepository.findByIdForUpdate(1L))
        .thenReturn(Optional.of(linkedStockItem(1L, 5L)));
    when(itemRepository.existsHoldOrConfirmedForMenu(5L)).thenReturn(true);

    assertThatThrownBy(() -> service.linkMenu(1L, new MenuLinkRequest(10L)))
        .isInstanceOf(BusinessException.class);

    InOrder order = inOrder(inventoryRepository, itemRepository);
    order.verify(inventoryRepository).findByIdForUpdate(1L);
    order.verify(itemRepository).existsHoldOrConfirmedForMenu(5L);
  }
}
