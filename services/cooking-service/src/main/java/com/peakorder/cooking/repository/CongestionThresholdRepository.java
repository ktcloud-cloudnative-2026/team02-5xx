package com.peakorder.cooking.repository;

import com.peakorder.cooking.entity.CongestionThreshold;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CongestionThresholdRepository extends JpaRepository<CongestionThreshold, Long> {

  /** 현재 혼잡 기준값 조회 (기준값은 1행으로 관리한다고 가정) */
  Optional<CongestionThreshold> findFirstByOrderByIdAsc();
}
