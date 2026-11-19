package com.peakorder.cooking.client;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withBadRequest;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withException;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.peakorder.cooking.client.MenuClient.PurchaseLine;
import com.peakorder.cooking.client.MenuClient.ValidatedMenu;
import com.peakorder.cooking.exception.BusinessException;
import com.peakorder.cooking.exception.ErrorCode;
import java.net.SocketTimeoutException;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

/** MI-01 계약(PR #90)대로 요청을 보내고, 응답·실패를 약속한 에러 코드로 바꾸는지 확인한다. */
class HttpMenuClientTest {

  private static final String URL = "http://menu.test/internal/v1/menus/validate-purchase";

  private MockRestServiceServer server;
  private HttpMenuClient client;

  @BeforeEach
  void setUp() {
    RestClient.Builder builder = RestClient.builder().baseUrl("http://menu.test");
    server = MockRestServiceServer.bindTo(builder).build();
    client = new HttpMenuClient(builder.build());
  }

  private static final List<PurchaseLine> LINES =
      List.of(new PurchaseLine(1L, 2, List.of(10L)), new PurchaseLine(2L, 1, List.of()));

  private static ErrorCode errorCodeOf(Throwable e) {
    return ((BusinessException) e).errorCode();
  }

  @Test
  void 계약대로_요청하고_조리_시간을_읽는다() {
    server
        .expect(requestTo(URL))
        .andExpect(method(HttpMethod.POST))
        // 옵션이 없어도 optionIds는 빈 배열로 보낸다 (MI-01 필수 필드)
        .andExpect(
            content()
                .json(
                    """
                    {"items":[{"menuId":1,"quantity":2,"optionIds":[10]},
                              {"menuId":2,"quantity":1,"optionIds":[]}]}
                    """))
        .andRespond(
            withSuccess(
                """
                {"success":true,"message":"OK","data":{"items":[
                  {"menuId":1,"menuName":"아메리카노","unitPrice":3000,"cookTimeSec":120,
                   "options":[{"optionId":10,"optionName":"샷 추가","extraPrice":500,"extraCookTimeSec":30}]},
                  {"menuId":2,"menuName":"라떼","unitPrice":4000,"cookTimeSec":90,"options":[]}]}}
                """,
                MediaType.APPLICATION_JSON));

    List<ValidatedMenu> menus = client.validatePurchase(LINES);

    assertThat(menus).extracting(ValidatedMenu::cookTimeSec).containsExactly(120, 90);
    assertThat(menus.get(0).options().get(0).extraCookTimeSec()).isEqualTo(30);
    server.verify();
  }

  @Test
  void Menu가_400이면_MENU_NOT_AVAILABLE() {
    server
        .expect(requestTo(URL))
        .andRespond(
            withBadRequest()
                .contentType(MediaType.APPLICATION_JSON)
                .body(
                    "{\"success\":false,\"message\":\"Menu is not available for purchase\","
                        + "\"errorCode\":\"INVALID_REQUEST\"}"));

    assertThatThrownBy(() -> client.validatePurchase(LINES))
        .extracting(HttpMenuClientTest::errorCodeOf)
        .isEqualTo(ErrorCode.MENU_NOT_AVAILABLE);
  }

  @Test
  void Menu가_500이면_MENU_SERVICE_UNAVAILABLE() {
    server.expect(requestTo(URL)).andRespond(withServerError());

    assertThatThrownBy(() -> client.validatePurchase(LINES))
        .extracting(HttpMenuClientTest::errorCodeOf)
        .isEqualTo(ErrorCode.MENU_SERVICE_UNAVAILABLE);
  }

  @Test
  void 타임아웃이면_MENU_SERVICE_UNAVAILABLE() {
    server.expect(requestTo(URL)).andRespond(withException(new SocketTimeoutException("timeout")));

    assertThatThrownBy(() -> client.validatePurchase(LINES))
        .extracting(HttpMenuClientTest::errorCodeOf)
        .isEqualTo(ErrorCode.MENU_SERVICE_UNAVAILABLE);
  }

  @Test
  void 응답_항목_수가_요청과_다르면_UPSTREAM_INVALID_RESPONSE() {
    server
        .expect(requestTo(URL))
        .andRespond(
            withSuccess(
                """
                {"success":true,"message":"OK","data":{"items":[
                  {"menuId":1,"menuName":"아메리카노","unitPrice":3000,"cookTimeSec":120,"options":[]}]}}
                """,
                MediaType.APPLICATION_JSON));

    assertThatThrownBy(() -> client.validatePurchase(LINES))
        .extracting(HttpMenuClientTest::errorCodeOf)
        .isEqualTo(ErrorCode.UPSTREAM_INVALID_RESPONSE);
  }

  @Test
  void 깨진_응답이면_UPSTREAM_INVALID_RESPONSE() {
    server.expect(requestTo(URL)).andRespond(withSuccess("{not json", MediaType.APPLICATION_JSON));

    assertThatThrownBy(() -> client.validatePurchase(LINES))
        .extracting(HttpMenuClientTest::errorCodeOf)
        .isEqualTo(ErrorCode.UPSTREAM_INVALID_RESPONSE);
  }

  /** LINES = [메뉴1(옵션10) ×2, 메뉴2 ×1] 에 대한 응답 본문 */
  private void respond(String items) {
    server
        .expect(requestTo(URL))
        .andRespond(
            withSuccess(
                "{\"success\":true,\"message\":\"OK\",\"data\":{\"items\":[" + items + "]}}",
                MediaType.APPLICATION_JSON));
  }

  private static final String MENU1 =
      "{\"menuId\":1,\"menuName\":\"아메리카노\",\"unitPrice\":3000,\"cookTimeSec\":120,"
          + "\"options\":[{\"optionId\":10,\"optionName\":\"샷 추가\",\"extraPrice\":500,"
          + "\"extraCookTimeSec\":30}]}";
  private static final String MENU2 =
      "{\"menuId\":2,\"menuName\":\"라떼\",\"unitPrice\":4000,\"cookTimeSec\":90,\"options\":[]}";

  @Test
  void 응답_순서가_요청과_다르면_UPSTREAM_INVALID_RESPONSE() {
    respond(MENU2 + "," + MENU1); // 메뉴 순서가 뒤바뀜

    assertThatThrownBy(() -> client.validatePurchase(LINES))
        .extracting(HttpMenuClientTest::errorCodeOf)
        .isEqualTo(ErrorCode.UPSTREAM_INVALID_RESPONSE);
  }

  @Test
  void 응답_옵션이_요청과_다르면_UPSTREAM_INVALID_RESPONSE() {
    respond(MENU1.replace("\"optionId\":10", "\"optionId\":11") + "," + MENU2);

    assertThatThrownBy(() -> client.validatePurchase(LINES))
        .extracting(HttpMenuClientTest::errorCodeOf)
        .isEqualTo(ErrorCode.UPSTREAM_INVALID_RESPONSE);
  }

  @Test
  void cookTimeSec이_빠지면_0으로_계산하지_않고_UPSTREAM_INVALID_RESPONSE() {
    respond(MENU1 + "," + MENU2.replace("\"cookTimeSec\":90,", ""));

    assertThatThrownBy(() -> client.validatePurchase(LINES))
        .extracting(HttpMenuClientTest::errorCodeOf)
        .isEqualTo(ErrorCode.UPSTREAM_INVALID_RESPONSE);
  }

  @Test
  void extraCookTimeSec이_빠지면_UPSTREAM_INVALID_RESPONSE() {
    respond(MENU1.replace(",\"extraCookTimeSec\":30", "") + "," + MENU2);

    assertThatThrownBy(() -> client.validatePurchase(LINES))
        .extracting(HttpMenuClientTest::errorCodeOf)
        .isEqualTo(ErrorCode.UPSTREAM_INVALID_RESPONSE);
  }

  @Test
  void 같은_메뉴를_옵션만_다르게_담아도_순서대로_검증한다() {
    List<PurchaseLine> sameMenuTwice =
        List.of(new PurchaseLine(1L, 1, List.of()), new PurchaseLine(1L, 1, List.of(10L)));
    respond(MENU1.replaceFirst("\\[\\{\"optionId.*?\\}\\]", "[]") + "," + MENU1);

    List<ValidatedMenu> menus = client.validatePurchase(sameMenuTwice);

    assertThat(menus).extracting(m -> m.options().size()).containsExactly(0, 1);
  }
}
