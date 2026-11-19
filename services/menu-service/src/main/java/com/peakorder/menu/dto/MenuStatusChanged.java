package com.peakorder.menu.dto;

import com.peakorder.menu.entity.MenuStatus;

public record MenuStatusChanged(Long menuId, MenuStatus status) {}
