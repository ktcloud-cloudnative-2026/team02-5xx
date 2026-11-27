package com.peakorder.inventory.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
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
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
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

  // ===== IN-02 목록 =====

  @Test
  void list_returns_all_not_deleted_items() {
    when(inventoryRepository.findByDeletedAtIsNullOrderByIdAsc())
        .thenReturn(List.of(stockItem(1L, 10, 0), stockItem(2L, 2, 0)));

    List<StockItemResponse> response = service.list(false);

    assertThat(response).extracting(StockItemResponse::stockItemId).containsExactly(1L, 2L);
  }

  @Test
  void list_returns_only_low_stock_when_requested() {
    // 기준치 2: 1번 가용 10(충분), 2번 가용 2(부족), 3번 가용 1(부족)
    when(inventoryRepository.findByDeletedAtIsNullOrderByIdAsc())
        .thenReturn(List.of(stockItem(1L, 10, 0), stockItem(2L, 2, 0), stockItem(3L, 5, 4)));

    List<StockItemResponse> response = service.list(true);

    assertThat(response).extracting(StockItemResponse::stockItemId).containsExactly(2L, 3L);
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
  void linkMenu_returns_conflict_when_concurrent_link_hits_unique() {
    // 사전 확인은 통과했지만 다른 재고가 같은 메뉴를 먼저 커밋해 menu_id UNIQUE에 걸린 경우
    when(menuClient.checkExistence(10L)).thenReturn(new MenuExistence(10L, true, "ON_SALE"));
    when(inventoryRepository.findByIdForUpdate(1L)).thenReturn(Optional.of(stockItem(1L, 10, 0)));
    when(inventoryRepository.findByMenuId(10L)).thenReturn(Optional.empty());
    doThrow(new DataIntegrityViolationException("menu_id")).when(inventoryRepository).flush();

    assertThatThrownBy(() -> service.linkMenu(1L, new MenuLinkRequest(10L)))
        .isInstanceOf(BusinessException.class)
        .extracting("errorCode")
        .isEqualTo(ErrorCode.MENU_ALREADY_LINKED);
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

  // ===== IN-06 논리 삭제 =====

  private Inventory deletedStockItem(long id) {
    Inventory inventory = stockItem(id, 10, 0);
    inventory.delete();
    return inventory;
  }

  @Test
  void delete_marks_deleted_and_unlinks_menu() {
    Inventory inventory = linkedStockItem(1L, 5L);
    when(inventoryRepository.findByIdForUpdate(1L)).thenReturn(Optional.of(inventory));
    when(itemRepository.existsHoldOrConfirmedForMenu(5L)).thenReturn(false);

    StockItemResponse response = service.delete(1L);

    assertThat(inventory.isDeleted()).isTrue();
    assertThat(inventory.getMenuId()).isNull();
    assertThat(response.menuId()).isNull();
  }

  @Test
  void delete_throws_not_found_when_no_item() {
    when(inventoryRepository.findByIdForUpdate(99L)).thenReturn(Optional.empty());

    assertThatThrownBy(() -> service.delete(99L))
        .isInstanceOf(BusinessException.class)
        .extracting("errorCode")
        .isEqualTo(ErrorCode.INVENTORY_NOT_FOUND);
  }

  @Test
  void delete_throws_not_found_when_already_deleted() {
    when(inventoryRepository.findByIdForUpdate(1L)).thenReturn(Optional.of(deletedStockItem(1L)));

    assertThatThrownBy(() -> service.delete(1L))
        .isInstanceOf(BusinessException.class)
        .extracting("errorCode")
        .isEqualTo(ErrorCode.INVENTORY_NOT_FOUND);
  }

  @Test
  void delete_rejects_when_hold_or_confirmed_order_remains() {
    Inventory inventory = linkedStockItem(1L, 5L);
    when(inventoryRepository.findByIdForUpdate(1L)).thenReturn(Optional.of(inventory));
    when(itemRepository.existsHoldOrConfirmedForMenu(5L)).thenReturn(true);

    assertThatThrownBy(() -> service.delete(1L))
        .isInstanceOf(BusinessException.class)
        .extracting("errorCode")
        .isEqualTo(ErrorCode.STOCK_ITEM_IN_USE);
    assertThat(inventory.isDeleted()).isFalse();
    assertThat(inventory.getMenuId()).isEqualTo(5L);
  }

  @Test
  void restock_throws_not_found_when_deleted() {
    when(inventoryRepository.findByIdForUpdate(1L)).thenReturn(Optional.of(deletedStockItem(1L)));

    assertThatThrownBy(() -> service.restock(1L, new StockRestockRequest(10)))
        .isInstanceOf(BusinessException.class)
        .extracting("errorCode")
        .isEqualTo(ErrorCode.INVENTORY_NOT_FOUND);
  }

  @Test
  void linkMenu_throws_not_found_when_deleted() {
    when(menuClient.checkExistence(10L)).thenReturn(new MenuExistence(10L, true, "ON_SALE"));
    when(inventoryRepository.findByIdForUpdate(1L)).thenReturn(Optional.of(deletedStockItem(1L)));

    assertThatThrownBy(() -> service.linkMenu(1L, new MenuLinkRequest(10L)))
        .isInstanceOf(BusinessException.class)
        .extracting("errorCode")
        .isEqualTo(ErrorCode.INVENTORY_NOT_FOUND);
  }

  // ===== 상태 변경 로그(#459): 실제로 바뀐 경우에만 =====

  private ListAppender<ILoggingEvent> captureLogs() {
    Logger logger = (Logger) LoggerFactory.getLogger(InventoryAdminService.class);
    ListAppender<ILoggingEvent> logs = new ListAppender<>();
    logs.start();
    logger.addAppender(logs);
    return logs;
  }

  private void stopCapturing(ListAppender<ILoggingEvent> logs) {
    ((Logger) LoggerFactory.getLogger(InventoryAdminService.class)).detachAppender(logs);
  }

  private List<String> messages(ListAppender<ILoggingEvent> logs) {
    return logs.list.stream().map(ILoggingEvent::getFormattedMessage).toList();
  }

  @Test
  void create_and_restock_log_the_change() {
    ListAppender<ILoggingEvent> logs = captureLogs();
    try {
      Inventory saved = stockItem(5L, 10, 0);
      when(inventoryRepository.save(any())).thenReturn(saved);
      service.create(new StockItemCreateRequest(10, 2));

      when(inventoryRepository.findByIdForUpdate(5L)).thenReturn(Optional.of(saved));
      service.restock(5L, new StockRestockRequest(3));

      assertThat(messages(logs))
          .containsExactly(
              "재고 항목 등록 stockItemId=5 stockQty=10", "재고 추가 stockItemId=5 quantity=3 stockQty=13");
    } finally {
      stopCapturing(logs);
    }
  }

  @Test
  void link_and_unlink_log_only_when_the_link_changes() {
    ListAppender<ILoggingEvent> logs = captureLogs();
    try {
      Inventory item = stockItem(5L, 10, 0);
      when(menuClient.checkExistence(7L)).thenReturn(new MenuExistence(7L, true, "ON_SALE"));
      when(inventoryRepository.findByIdForUpdate(5L)).thenReturn(Optional.of(item));
      when(inventoryRepository.findByMenuId(7L)).thenReturn(Optional.empty());

      service.linkMenu(5L, new MenuLinkRequest(7L));
      service.linkMenu(5L, new MenuLinkRequest(7L)); // 같은 메뉴: 바뀐 것이 없다
      service.linkMenu(5L, new MenuLinkRequest(null));
      service.linkMenu(5L, new MenuLinkRequest(null)); // 이미 해제: 바뀐 것이 없다

      assertThat(messages(logs))
          .containsExactly(
              "재고 메뉴 연결 stockItemId=5 menuId=7", "재고 메뉴 연결 해제 stockItemId=5 previousMenuId=7");
    } finally {
      stopCapturing(logs);
    }
  }

  @Test
  void rejected_changes_do_not_log() {
    ListAppender<ILoggingEvent> logs = captureLogs();
    try {
      Inventory item = linkedStockItem(5L, 7L);
      when(inventoryRepository.findByIdForUpdate(5L)).thenReturn(Optional.of(item));
      when(itemRepository.existsHoldOrConfirmedForMenu(7L)).thenReturn(true);

      assertThatThrownBy(() -> service.delete(5L)).isInstanceOf(BusinessException.class);
      assertThatThrownBy(() -> service.linkMenu(5L, new MenuLinkRequest(null)))
          .isInstanceOf(BusinessException.class);
      assertThatThrownBy(() -> service.restock(99L, new StockRestockRequest(1)))
          .isInstanceOf(BusinessException.class);

      assertThat(logs.list).isEmpty();
    } finally {
      stopCapturing(logs);
    }
  }

  @Test
  void delete_logs_the_removed_item() {
    ListAppender<ILoggingEvent> logs = captureLogs();
    try {
      Inventory item = linkedStockItem(5L, 7L);
      when(inventoryRepository.findByIdForUpdate(5L)).thenReturn(Optional.of(item));
      when(itemRepository.existsHoldOrConfirmedForMenu(7L)).thenReturn(false);

      service.delete(5L);

      assertThat(messages(logs)).containsExactly("재고 항목 삭제 stockItemId=5 previousMenuId=7");
    } finally {
      stopCapturing(logs);
    }
  }
}
