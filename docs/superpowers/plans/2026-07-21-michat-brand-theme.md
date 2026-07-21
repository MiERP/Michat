# MiChat Brand Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Áp dụng phương án giao diện Đậm thương hiệu cho cả chế độ sáng và tối.

**Architecture:** Tập trung bảng màu trong CSS variables, sau đó dùng bốn lớp thương hiệu nhỏ tại các component dùng chung. Không thêm dependency và không đổi logic ứng dụng.

**Tech Stack:** React, TypeScript, Tailwind CSS v4, CSS custom properties, Electron.

---

### Task 1: Token màu thương hiệu

**Files:**

- Modify: `src/renderer/src/assets/theme.css`

- [ ] Thay token xanh lam/xám bằng bảng màu xanh-cam cho `:root` và `.dark`.
- [ ] Thêm gradient cho thanh điều hướng, panel, nút chính và trạng thái chọn.
- [ ] Ánh xạ token thương hiệu qua `@theme inline`.

### Task 2: Thành phần dùng chung

**Files:**

- Modify: `src/renderer/src/components/ui/button.tsx`
- Modify: `src/renderer/src/components/ui/panel-header.tsx`
- Modify: `src/renderer/src/components/common/TopNavigationBar.tsx`

- [ ] Đổi nút mặc định sang gradient cam và giữ nguyên các variant khác.
- [ ] Gắn nền gradient nhẹ cho panel header.
- [ ] Gắn gradient xanh cho topbar và điều chỉnh tab để giữ tương phản.

### Task 3: Trạng thái chọn tài liệu

**Files:**

- Modify: `src/renderer/src/components/notebook/source/DocumentList.tsx`

- [ ] Dùng lớp chọn xanh gradient thay cho `bg-muted`.
- [ ] Giữ focus ring và `aria-selected` hiện có.

### Task 4: Xác minh

**Files:**

- Verify: `src/renderer/src/assets/theme.css`
- Verify: `src/renderer/src/components/ui/button.tsx`
- Verify: `src/renderer/src/components/ui/panel-header.tsx`
- Verify: `src/renderer/src/components/common/TopNavigationBar.tsx`
- Verify: `src/renderer/src/components/notebook/source/DocumentList.tsx`

- [ ] Chạy Prettier và ESLint trên các file thay đổi.
- [ ] Chạy `pnpm run typecheck:web`.
- [ ] Chạy `pnpm run build`.
- [ ] Mở Electron ở cả giao diện sáng và tối, kiểm tra tương phản và gradient.
