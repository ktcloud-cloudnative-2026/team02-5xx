package com.peakorder.order.service;

import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * 트랜잭션이 커밋된 뒤에 실행한다. 상태 전이 로그를 커밋 전에 남기면 이후 flush·커밋이 실패해 롤백돼도 "바뀌었다"는 로그만 남으므로, 커밋이 끝난 뒤에만 남긴다.
 * 트랜잭션 밖(동기화가 없는 호출)이면 바로 실행한다.
 */
final class AfterCommit {

  private AfterCommit() {}

  static void run(Runnable action) {
    if (TransactionSynchronizationManager.isSynchronizationActive()) {
      TransactionSynchronizationManager.registerSynchronization(
          new TransactionSynchronization() {
            @Override
            public void afterCommit() {
              action.run();
            }
          });
    } else {
      action.run();
    }
  }
}
