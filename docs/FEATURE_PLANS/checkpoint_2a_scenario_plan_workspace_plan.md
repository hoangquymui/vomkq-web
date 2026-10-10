# IMPLEMENTATION PLAN: CHECKPOINT 2A — SCENARIO / PLAN WORKSPACE (v2 REVISED + FINAL CONTRACT ADDENDUM)

**Dự án**: VOMKQ Web (Hệ thống Mô phỏng & Lập kế hoạch Phòng không)  
**Checkpoint**: 2A — Scenario / Plan Workspace  
**Phiên bản kế hoạch**: v2 REVISED + FINAL CONTRACT ADDENDUM  
**Trạng thái**: Chờ phê duyệt từ Human (Pending Human Approval)  
**Quy tắc tối thượng**: TUYỆT ĐỐI CHƯA VIẾT CODE TRƯỚC KHI HUMAN PHÊ DUYỆT BẢN KẾ HOẠCH  

---

## 1. MỤC TIÊU & TẦNG NGHIỆP VỤ (EXECUTIVE SUMMARY & DECISION LOOP)

### 1.1. Mục tiêu Checkpoint 2A
Xây dựng một tính năng hoàn chỉnh theo chiều dọc:
```text
Domain Model → Application / Store → UI (TopBar, Inspector, Modal, Sidebar) → 2D/3D (Cesium) → Serialization & Audit
```
nhằm cung cấp cho người dùng khả năng thực sự quản lý **Kịch bản tác chiến (Scenarios)** và các **Phương án bố trí thay thế (Plans / Alternatives)** một cách trực quan, nhất quán, an toàn dữ liệu và tuân thủ tuyệt đối chuẩn North Star.

### 1.2. Vị trí trong Chu trình Ra Quyết định (Decision Loop)
Trong chu trình tác chiến của North Star:
$$\text{Model} \longrightarrow \mathbf{\text{SCENARIO / PLAN}} \longrightarrow \text{Simulate} \longrightarrow \text{Assess} \longrightarrow \text{Compare} \longrightarrow \text{Review} \longrightarrow \text{Replay}$$

Checkpoint 2A giải quyết trọng tâm ở bước **SCENARIO & PLAN (Lập phương án tác chiến)**:
- **Scenario**: Thiết lập bối cảnh tác chiến (không gian địa hình, thời gian, mục tiêu bảo vệ, phiên bản địa hình).
- **Plan**: Phương án bố trí khí tài cụ thể (baseline gốc hoặc các phương án alternative A, B, C...) được sinh ra từ kịch bản đó.
- Checkpoint 2A là nền tảng tiên quyết để các bước sau (SimulationRun, Compare, Assessment) có thể tham chiếu chính xác `scenarioId` và `planId` có xuất xứ (provenance) rõ ràng.

### 1.3. Phạm vi triển khai (In-Scope)
1. **Scenario Workspace**:
   - Tạo kịch bản mới (`createScenario`). Tự động sinh kèm một Baseline Plan ban đầu.
   - Xem danh sách kịch bản hiện có cùng thông số trạng thái và số lượng phương án.
   - Chọn / chuyển đổi kịch bản làm việc (`switchScenario`).
   - Đổi tên kịch bản (`renameScenario`).
2. **Plan Workspace**:
   - Tạo phương án trắng mới (`createEmptyPlan`).
   - Nhân bản phương án thay thế (`createPlanAlternative`) từ một phương án có sẵn với phiên bản được tăng tự động.
   - Đổi tên phương án (`renamePlan`).
   - Chọn / chuyển đổi phương án hiện hành (`switchActivePlan`).
   - Kiểm tra tính toàn vẹn của đồ thị khí tài trong phương án (`validateActivePlan` / `saveActivePlan`).
   - Đề xuất phương án xét duyệt (`proposePlan`: chuyển trạng thái `draft` → `proposed` và đóng băng chỉnh sửa).
3. **UI / Presentation Layer**:
   - Header / TopBar hiển thị trực quan Kịch bản và Phương án hiện hành kèm Huy hiệu Trạng thái (`draft` / `active` / `archived` và `draft` / `proposed` / `approved`) cùng Phiên bản `v{version}`.
   - Bộ chọn nhanh Phương án (Quick Plan Switcher Dropdown) ngay trên TopBar.
   - Bảng điều khiển quản lý không gian làm việc (`WorkspaceModal`) gồm 2 tab: *Kịch Bản* và *Phương Án*.
   - RightInspector hiển thị ngữ cảnh Scenario/Plan; cảnh báo chỉ đọc (Read-only banner) và vô hiệu hóa form chỉnh sửa khi phương án ở trạng thái `proposed` hoặc `approved`.
   - LeftSidebar cảnh báo và vô hiệu hóa hành động đặt khí tài mới khi phương án hiện hành bị khóa.
4. **2D & 3D Globe Parity & Context Isolation**:
   - Chuyển đổi phương án tự động cập nhật đồng bộ 2D và 3D (Cesium) thông qua projection `selectActiveEquipment(state)`.
   - Reset lựa chọn khí tài (`selectedInstanceId: null`), công cụ và các dữ liệu tính toán tạm khi chuyển đổi ngữ cảnh để tránh rò rỉ dữ liệu giữa các phương án.
5. **Serialization & Audit Trail**:
   - Xuất / nhập gói dữ liệu Canonical Package (`exportCanonicalPackage`, `importCanonicalPackage`) chuẩn Schema Version 1 bảo toàn đầy đủ quan hệ sở hữu kịch bản, phương án, placements, definitions, visuals, simulation runs.
   - Ghi nhận Audit Event chuẩn xác cho các thao tác trên Scenario và Plan theo đúng union types và API signatures hiện có.
6. **Xử lý lỗi (Error Handling)**:
   - Bắt lỗi giao dịch nguyên tử (fail-fast atomic), không để lại trạng thái dở dang nếu thao tác thất bại.
   - Thông báo lỗi thân thiện trên UI.

### 1.4. Loại trừ tường minh (Out-of-Scope)
- **KHÔNG** triển khai SimulationRun engine hoặc chạy mô phỏng.
- **KHÔNG** triển khai thuật toán tính điểm đánh giá (Assessment) hoặc tự động chọn phương án tối ưu.
- **KHÔNG** triển khai tự động phê duyệt `approved` (Trạng thái `approved` được bảo lưu cho quy trình Human Review sau này).
- **KHÔNG** refactor các module không liên quan (như SPx math, shader, TDoA calculator).
- **KHÔNG** sửa đổi governance rules, skills hoặc workflows.

---

## 2. XÁC NHẬN BASELINE & TRẠNG THÁI GIT

1. **Trạng thái Git HEAD**:
   - Commit `7a837cccf`: `refactor(store): retire legacy instances authority` (Checkpoint 1K).
   - Commit `2776653f7`: `chore(governance): upgrade agents to v1.4 with fast validation and evidence workflow` (Governance v1.4).
   - Nhánh làm việc: `north-star-migration`.
2. **Kiểm tra Suite Test hiện tại**:
   - Toàn bộ **112 / 112 tests PASS** (4 test files: `legacyEquipmentAdapter.test.ts`, `auditEngine.test.ts`, `useTacticalStore.test.ts`, `serialization.test.ts`).
   - `npx tsc -b --pretty false`: **0 lỗi compilation**.
3. **Chính sách Test Checkpoint 2A**:
   - Chỉ thêm **ĐÚNG MỘT** file test tích hợp: `src/store/workspaceIntegration.test.ts`.
   - Không sửa, không xóa, không skip bất kỳ test nào trong 112 tests cũ.

---

## 3. PHÂN TÍCH DOMAIN & VÒNG ĐỜI (DOMAIN & LIFECYCLE MODEL)

### 3.1. Phân biệt Trạng thái Scenario (`status`) và Con trỏ Ngữ cảnh (`activeScenarioId`)
- **`Scenario.status` (`'draft' | 'active' | 'archived'`)**:
  - Thuộc tính vòng đời nghiệp vụ lâu dài của kịch bản:
    - `'draft'`: Kịch bản đang trong giai đoạn soạn thảo ban đầu.
    - `'active'`: Kịch bản tác chiến đang được áp dụng chính thức cho đơn vị.
    - `'archived'`: Kịch bản đã kết thúc hoặc lưu kho lịch sử. **Đóng băng toàn bộ**: Mọi thao tác chỉnh sửa phương án hoặc thay đổi khí tài thuộc kịch bản này đều bị chặn triệt để bởi `validateActiveScenarioContext` / `validateMutationGuard`.
- **`state.activeScenarioId` (`string | null`)**:
  - Con trỏ phiên làm việc tạm thời của UI (session pointer), chỉ định kịch bản nào đang được nạp lên màn hình làm việc của người dùng.
  - Người dùng có thể mở xem một kịch bản `'archived'` (khi đó `activeScenarioId` trỏ vào nó, nhưng toàn bộ giao diện chuyển sang chế độ Xem Chỉ Đọc).
  - Khái niệm: `Scenario.status === 'active'` (trạng thái tác chiến) $\neq$ `state.activeScenarioId === id` (đang mở trong phiên làm việc).

### 3.2. Bảng Chuyển Đổi Trạng Thái Phương Án (Plan State Transition Matrix)
Các trạng thái của Plan: `'draft' | 'proposed' | 'approved'`.

| Trạng thái hiện tại | Thao tác chuyển đổi | Trạng thái đích | Tính hợp lệ trong 2A | Ràng buộc / Hành vi nghiệp vụ |
| :--- | :--- | :--- | :---: | :--- |
| **`draft`** | `proposePlan(id)` | **`proposed`** | **HỢP LỆ** | Chạy `validatePlanGraph`. Đóng băng chỉnh sửa khí tài. Ghi audit `'UPDATE'`. |
| **`draft`** | Phê duyệt trực tiếp | **`approved`** | **KHÔNG HỢP LỆ** | Bị cấm trong 2A. Phải qua bước đề xuất (`proposed`) và Human Review. |
| **`proposed`** | Quay lại nháp | **`draft`** | **KHÔNG HỢP LỆ** | Bị cấm trong 2A. Muốn sửa, người dùng phải dùng `createPlanAlternative` để tạo phương án nháp mới. |
| **`proposed`** | Phê duyệt chính thức | **`approved`** | **BẢO LƯU (Reserved)** | Dành cho Human Review Gate trong các checkpoint sau; không tự động phê duyệt trong 2A. |
| **`approved`** | Mọi chuyển đổi | Bất kỳ | **KHÔNG HỢP LỆ** | Bị cấm tuyệt đối. Phương án đã phê duyệt là bản ghi quyết định bất biến (Immutable Decision Record). |

### 3.3. Quy định về Baseline Plan, Empty Plan và Cập nhật `Plan.version`
1. **Baseline Plan vs Empty Plan**:
   - Khi tạo Kịch bản mới (`createScenario(name, terrainVersion)`):
     Hệ thống tự động khởi tạo **Một Baseline Plan duy nhất** (ví dụ: `name = 'Phương án cơ sở (Baseline)'`, `version = 1`, `status = 'draft'`).
   - Khi người dùng muốn tạo một phương án trắng không sao chép từ đâu trong kịch bản hiện tại:
     Sử dụng `createEmptyPlan(name?)` $\to$ sinh ra một Plan trắng rỗng (`placements` rỗng, `version = 1`, `status = 'draft'`).
2. **Quy tắc chọn Plan Deterministic khi gọi `switchScenario(scenarioId)`**:
   - **Tuyệt đối không tự động sinh Baseline Plan ngầm** khi chuyển Scenario (tránh phát sinh mutation không mong muốn).
   - Lọc danh sách plans thuộc `scenarioId`: `matchingPlans = Object.values(state.plans).filter(p => p.scenarioId === scenarioId)`.
   - **Quy tắc sắp xếp Deterministic**: Sắp xếp danh sách plans theo thứ tự:
     `matchingPlans.sort((a, b) => a.version - b.version || a.id.localeCompare(b.id))`
   - Nếu kịch bản có ít nhất một Plan: Chọn plan đầu tiên theo thứ tự trên (`activePlanId = matchingPlans[0].id`).
   - Nếu kịch bản rỗng (không có bất kỳ Plan nào): Thiết lập `activePlanId = null` và `selectedInstanceId = null`. Giao diện hiển thị Empty State hợp lệ (*"Kịch bản chưa có phương án tác chiến nào. Hãy tạo phương án mới để bắt đầu."*).
   - Kịch bản `archived`: Luôn luôn Read-Only, không phát sinh bất kỳ mutation ngầm nào khi chuyển sang hoặc xem.
3. **Quy tắc cập nhật `Plan.version`**:
   - Khi tạo Baseline Plan hoặc Empty Plan: `version = 1`.
   - Khi nhân bản phương án (`createPlanAlternative(sourcePlanId)`):
     Tìm phiên bản lớn nhất hiện có của các plans trong cùng Scenario:
     $$\text{newVersion} = \max(\{p.\text{version} \mid p \in \text{plansInScenario}\}) + 1$$
     Đảm bảo phiên bản luôn tăng đơn điệu trong phạm vi kịch bản.
   - Khi chỉnh sửa khí tài trong một phương án đang ở trạng thái `draft`: `Plan.version` **GIỮ NGUYÊN** (version đại diện cho danh tính snapshot phương án; chuỗi lịch sử vi mô do `RevisionMetadata.sequence` và `revisionHeads` quản lý).

### 3.4. Ranh giới Quyền sở hữu (Ownership Invariants)
Cần phân biệt rõ:
1. **Toàn bộ Canonical Registry** (`state.placements`, `state.definitions`, `state.observations`, `state.visuals`):
   - Là bảng băm chuẩn hóa toàn cục chứa tất cả các thực thể của **TẤT CẢ** các Plans trong toàn bộ ứng dụng.
   - Mỗi `EquipmentPlacement` và `EquipmentDefinition` bắt buộc phải có thuộc tính `planId`.
   - Bất biến toàn cục: Mọi `placement` phải trỏ tới một `definition` có cùng `planId`:
     $$\forall p \in \text{placements}, \quad \text{definitions}[p.\text{definitionId}].\text{planId} === p.\text{planId}$$
2. **Active Plan Projection** (`selectActivePlacements(state)`, `selectActiveEquipment(state)`):
   - Là hình chiếu đọc (read-only projection view) chỉ lọc ra các phần tử thuộc phương án đang kích hoạt:
     $$\text{activePlacements} = \{p \in \text{state.placements} \mid p.\text{planId} === \text{state.activePlanId}\}$$
   - Renderer 2D, 3D và Inspector chỉ được phép đọc dữ liệu thông qua Active Plan Projection này, không bao giờ đọc trực tiếp từ registry thô.

---

## 4. CÔ LẬP TRẠNG THÁI NGỮ CẢNH & MA TRẬN CHẶN ĐỘT BIẾN (CONTEXT ISOLATION & MUTATION MATRIX)

### 4.1. Ma trận Phân loại Dữ liệu & Chuyển đổi Ngữ cảnh
Khi người dùng thực hiện chuyển Plan (`switchActivePlan`) hoặc chuyển Scenario (`switchScenario`), hệ thống phân định rõ 3 nhóm dữ liệu:

| Nhóm Dữ liệu | Thuộc tính cụ thể | Hành vi khi chuyển Plan/Scenario | Lý do & Bảo đảm an toàn |
| :--- | :--- | :---: | :--- |
| **A. Canonical Business Data** | `placements`, `definitions`, `observations`, `visuals` | **RETAIN TRONG REGISTRY (Không xóa)** | Dữ liệu nghiệp vụ chuẩn hóa được định danh theo `id` và `planId`. Không bao giờ bị xóa khi chuyển đổi ngữ cảnh. |
| **B. User-Controlled Configuration** | `samEngagementModes` | **RETAIN (Giữ nguyên theo `placementId`)** | Cấu hình chế độ bắn SAM do người dùng thiết lập cho khí tài; giữ nguyên để khi người dùng chuyển lại Plan cũ không bị mất cài đặt. |
| | `viewMode`, `basemap`, layer toggles | **RETAIN (Giữ nguyên)** | Cấu hình trải nghiệm người dùng toàn cục trên GIS. |
| | `terrainVersion` | **METADATA DISPLAY** | Metadata xuất xứ dữ liệu địa hình (provenance); hiển thị trên UI và package, không chuyển đổi runtime Cesium engine trong 2A. |
| **C. Derived / Transient Cache** | `coverageVolumes`, `spxResults`, `samVolumes` | **PURGE / INVALIDATE (`{}`)** | Dữ liệu tính toán dẫn xuất tạm thời; xóa bỏ để tránh hiển thị sai lệch kết quả của phương án cũ. |
| | `selectedInstanceId` | **RESET về `null`** | Tránh Inspector trỏ sang khí tài của phương án cũ. |
| | `pendingTemplate`, `measurePoints` | **RESET về `null` / `[]`** | Hủy thao tác tương tác đang dang dở. |
| | `activeSimulationRunId` | **RESET về `null`** | Ngắt kết nối với simulation run cũ. |

### 4.2. Ma trận Chặn Đột biến (Mutation Entry-Point Boundary Matrix)
Bảo đảm chốt chặn an toàn `validateMutationGuard(state)` được thực thi tại **tất cả mọi lối vào mutation ở tầng Store**, tạo nên kiến trúc phòng thủ theo chiều sâu (Defense-in-Depth):

| Entry Point | Vị trí gọi | Cơ chế bảo vệ tầng Store | Cơ chế hỗ trợ tầng UI |
| :--- | :--- | :--- | :--- |
| `addEquipment` | Catalog, Click Cesium, AI Advisor | `validateMutationGuard(state)` ném lỗi nếu plan !== `draft` hoặc scenario === `archived` | Vô hiệu hóa nút trong Catalog, hiện tooltip cảnh báo, hủy sự kiện click bản đồ. |
| `updateEquipment` | Inspector coords/params, Kéo thả | `validateMutationGuard(state)` ném lỗi | Vô hiệu hóa toàn bộ input/slider trong Inspector khi plan !== `draft`. |
| `removeEquipment` | Inspector delete, Phím tắt Del | `validateMutationGuard(state)` ném lỗi | Ẩn/disable nút xóa khí tài trong Inspector. |
| `clearAll` | TopBar nút thùng rác | `validateMutationGuard(state)` ném lỗi | Ẩn/disable nút xóa tất cả trên TopBar khi plan !== `draft`. |
| `importFromLayout`| Modal nạp layout JSON | `validateMutationGuard(state)` ném lỗi | Vô hiệu hóa nút nạp đè vào phương án đang khóa; khuyến khích nhân bản. |
| `loadSampleScenario`| Demo button | `validateMutationGuard(state)` ném lỗi | Vô hiệu hóa nếu phương án hiện tại đang khóa. |
| `updateEquipmentSpxConfig`| Inspector SPx tab | `validateMutationGuard(state)` ném lỗi | Vô hiệu hóa controls SPx. |
| `setSamEngagementMode`| Inspector SAM control | `validateMutationGuard(state)` ném lỗi | Vô hiệu hóa SAM modes selector. |
| `renamePlan` | WorkspaceModal, TopBar | Kiểm tra `plan.status === 'draft'` | Vô hiệu hóa nút đổi tên khi plan !== `draft`. |
| `proposePlan` | WorkspaceModal action | Kiểm tra `plan.status === 'draft'` + `validatePlanGraph` | Chỉ hiển thị cho plan đang ở trạng thái `draft`. |

### 4.3. Cô Lập Kết Quả Bất Đồng Bộ (Async Result Isolation)
Trong ứng dụng hiện có một số tác vụ bất đồng bộ (như lấy mẫu địa hình Cesium `calcAll`, tính toán SPx, hay AI placement fetch):
- **Nguyên tắc cô lập**: Mọi tác vụ bất đồng bộ phải ghi nhận ngữ cảnh yêu cầu: `requestPlanId = state.activePlanId` và `requestScenarioId = state.activeScenarioId`.
- Khi tác vụ bất đồng bộ hoàn tất:
  ```typescript
  if (requestPlanId !== useTacticalStore.getState().activePlanId) {
    // DISCARD: Người dùng đã chuyển sang Plan khác trong thời gian tác vụ đang chạy.
    // Tuyệt đối không ghi kết quả của Plan cũ vào Plan mới!
    return;
  }
  ```
- Không cho phép kết quả tính toán của Plan A ghi đè vào active context của Plan B.
- Không triển khai engine mô phỏng mới trong Checkpoint 2A.

---

## 5. AUDIT, REVISION & SERIALIZATION (ĐỐI CHIẾU CHÍNH XÁC VỚI CODE THỰC TẾ)

### 5.1. Bảng Ánh Xạ Chuẩn Xác Audit API Types & Signatures
Đối chiếu trực tiếp với [audit.ts](file:///e:/vompk/vomkq-web/src/domain/types/audit.ts) và [auditEngine.ts](file:///e:/vompk/vomkq-web/src/domain/audit/auditEngine.ts):

- **Lưu ý tối quan trọng**: `auditEngine.ts` hiện tại chỉ hỗ trợ `scope.type === 'PLAN'` và `scope.type === 'WORKSPACE'` (gọi `{ type: 'SCENARIO', ... }` sẽ ném lỗi runtime).
- Do đó, mọi thao tác cấp Scenario **bắt buộc** phải sử dụng scope `{ type: 'WORKSPACE', id: 'canonical-root' }`.

| Store Action | `RevisionScope` | `AuditAction` | `AuditTargetType` | `targetIds` | `actor` / `source` |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `createScenario` | `{ type: 'WORKSPACE', id: 'canonical-root' }` | `'ADD'` | `'SCENARIO'` | `[newScenarioId]` | `HUMAN` / `USER_ACTION` |
| `renameScenario` | `{ type: 'WORKSPACE', id: 'canonical-root' }` | `'UPDATE'` | `'SCENARIO'` | `[scenarioId]` | `HUMAN` / `USER_ACTION` |
| `createEmptyPlan` | `{ type: 'PLAN', id: newPlanId }` | `'ADD'` | `'PLAN'` | `[newPlanId]` | `HUMAN` / `USER_ACTION` |
| `renamePlan` | `{ type: 'PLAN', id: planId }` | `'UPDATE'` | `'PLAN'` | `[planId]` | `HUMAN` / `USER_ACTION` |
| `proposePlan` | `{ type: 'PLAN', id: planId }` | `'UPDATE'` | `'PLAN'` | `[planId]` | `HUMAN` / `USER_ACTION` (reason: `'PROPOSE_PLAN'`) |
| `createPlanAlternative`| `{ type: 'PLAN', id: newPlanId }` | `'BRANCH'` | `'PLAN'` | `[newPlanId]` | `HUMAN` / `USER_ACTION` (derivedFrom: parent rev) |
| `importCanonicalPackage`| `{ type: 'WORKSPACE', id: 'canonical-root' }` | `'IMPORT'` | `'WORKSPACE'` | `['canonical-root']`| `UNKNOWN` / `IMPORT` |

### 5.2. Sự Thật về Canonical State Package V1 (Tuyệt đối không đổi Schema Version)
- **Cấu trúc thực tế của `CanonicalStatePackageV1`**:
  Chứa chính xác **11 trường**:
  1. `schemaVersion` (giá trị cố định: 1)
  2. `metadata` (`exportedAt`, `layoutName`)
  3. `context` (`activeScenarioId`, `activePlanId`, `activeSimulationRunId`)
  4. `scenarios`
  5. `plans`
  6. `placements`
  7. `definitions`
  8. `observations`
  9. `simulationRuns`
  10. `simulations`
  11. `visuals`
- **Ranh giới trung thực**:
  - `CanonicalStatePackageV1` **KHÔNG** chứa `revisions`, `revisionHeads` hay `auditEvents`.
  - Checkpoint 2A **TUYỆT ĐỐI KHÔNG** tự ý nâng `schemaVersion` lên 2 (để không phá vỡ 35 tests trong `serialization.test.ts`).
  - Khi `exportCanonicalPackage(name)` được gọi: Toàn bộ snapshot canonical domain được đóng gói trung thực.
  - Khi `importCanonicalPackage(pkg)` được gọi: Hệ thống phục hồi toàn bộ canonical domain snapshot, và sau đó **sinh ra MỘT sự kiện Audit mới** (`action: 'IMPORT'`, `scope: 'WORKSPACE'`) để ghi nhận thời điểm nạp dữ liệu vào workspace. Không tuyên bố sai lệch rằng lịch sử audit cũ được khôi phục nếu schema không chứa nó.

### 5.3. Xử lý Observations khi Nạp Layout JSON (`importFromLayout`)
- Khí tài mới được import vào `activePlanId` sẽ được tạo mới `Placement`, `Definition`, `Visual` và `ObservationState` khởi tạo (`status` tương ứng).
- Các bản ghi `ObservationState` cũ trong `state.observations` thuộc về các khí tài trước đây **PHẢI ĐƯỢC GIỮ NGUYÊN BẤT BIẾN**, không bao giờ bị xóa bỏ khi thay thế bố cục (theo đúng North Star Mandatory Invariant: *Historical observations/simulations must not be silently removed merely because a Placement is deleted*).

### 5.4. Tính Nguyên tử và Chống Trạng thái Dở dang (Fail-Fast Atomic Transactions)
- Tất cả các thao tác kiểm tra tiền điều kiện (tên không rỗng, bản ghi tồn tại, kịch bản chưa archived, đồ thị khí tài hợp lệ `validatePlanGraph`) phải được thực hiện **TRƯỚC** khi gọi `set()`.
- Nếu có lỗi, ném Exception ngay lập tức. Zustand không cập nhật state, không có bản ghi nào bị ghi dở và không có audit event mồ côi nào được tạo ra.

---

## 6. THIẾT KẾ GIAO DIỆN & TƯƠNG TÁC NGƯỜI DÙNG (UI/UX SPECIFICATION)

### 6.1. Header / TopBar ([TopBar.tsx](file:///e:/vompk/vomkq-web/src/components/ui/TopBar.tsx))
```text
+-------------------------------------------------------------------------------------------------------------------+
| [VomKQ Logo] | [Kịch bản: Miền Bắc 2026 [HOẠT ĐỘNG]] | [Phương án: PA-01 (v1) [DRAFT] [v]] | [3D/2D] | [Workspace] |
+-------------------------------------------------------------------------------------------------------------------+
```
1. **Huy hiệu Kịch bản (Scenario Context Badge)**:
   - Tên kịch bản hiện hành.
   - Badge trạng thái: `NHÁP` (amber), `HOẠT ĐỘNG` (emerald), `LƯU TRỮ` (slate).
2. **Bộ chọn nhanh Phương án (Quick Plan Switcher Dropdown)**:
   - Hiển thị: `{activePlan.name} • v{activePlan.version}` kèm badge `DRAFT` / `ĐỀ XUẤT` / `ĐÃ DUYỆT`.
   - Click mở dropdown danh sách tất cả các phương án thuộc kịch bản hiện tại để chuyển đổi ngay lập tức với 1 click.
   - Chuyển phương án lập tức cập nhật Cesium 3D và 2D.
3. **Nút mở Workspace Modal**:
   - Nút bấm trực quan `"Không Gian Tác Chiến"` kèm icon `FolderKanban`.

### 6.2. Modal Quản Lý Không Gian Tác Chiến (`src/components/ui/WorkspaceModal.tsx` - FILE MỚI)
Modal nổi trung tâm (Glassmorphism dark theme) gồm 2 Tab:

#### Tab 1: Kịch Bản Tác Chiến (Scenarios)
- **Danh sách Kịch bản**:
  - Bảng hiển thị: Tên kịch bản, ID, Phiên bản địa hình (`terrainVersion`), Số lượng phương án, Ngày tạo, Trạng thái.
  - Tag `[ĐANG CHỌN]` cho kịch bản hiện hành; nút `"Kích Hoạt"` cho kịch bản khác.
  - Nút đổi tên kịch bản (vô hiệu hóa nếu kịch bản là `archived`).
- **Tác vụ Kịch bản**:
  - Nút `"+ Tạo Kịch Bản Mới"`: Mở form nhập tên kịch bản và phiên bản địa hình. Tự động chuyển kịch bản mới tạo thành hiện hành và tự động sinh sẵn Baseline Plan ban đầu.

#### Tab 2: Phương Án Bố Trí (Plans / Alternatives)
- **Thông tin Kịch bản ngữ cảnh**: Hiển thị rõ đang quản lý các phương án thuộc kịch bản nào.
- **Danh sách Phương án**:
  - Thẻ phương án hiển thị: Tên, Phiên bản (`v{plan.version}`), Số lượng khí tài bố trí, Trạng thái (`draft`, `proposed`, `approved`).
  - Nút thao tác:
    - `"Chọn Phương Án"`: Kích hoạt làm phương án hiện hành.
    - `"Nhân Bản (Clone Alternative)"`: Tạo một phương án nháp mới sao chép toàn bộ bố trí của phương án này với phiên bản tăng tự động.
    - `"Đổi Tên"`: Cho phép sửa tên (chỉ khả dụng nếu là `draft`).
    - `"Đề Xuất Xét Duyệt (Propose)"`: Chuyển trạng thái từ `draft` sang `proposed` (chỉ khả dụng khi hợp lệ).
    - `"Kiểm Tra Tính Hợp Lệ (Validate)"`: Chạy `validatePlanGraph` để kiểm tra đồ thị chỉ huy và liên kết khí tài.
- **Tác vụ Phương án**:
  - Nút `"+ Tạo Phương Án Trắng Mới"` (`createEmptyPlan`).
  - Nút `"Nhân Bản Phương Án Hiện Hành"`.

### 6.3. Bảng Thuộc Tính Khí Tài ([RightInspector.tsx](file:///e:/vompk/vomkq-web/src/components/ui/RightInspector.tsx))
1. **Phụ đề Ngữ cảnh (Header Context)**:
   - Hiển thị trên đầu bảng: `Kịch bản: {scenario.name} • Phương án: {plan.name} (v{plan.version})`.
2. **Thanh Cảnh Báo Chỉ Đọc (Read-Only Guard Banner)**:
   - Khi `activePlan.status !== 'draft'`:
     - Hiển thị banner màu xanh lam/vàng nổi bật:
       `🔒 Phương án đang ở trạng thái [ĐỀ XUẤT / ĐÃ DUYỆT]. Không thể chỉnh sửa trực tiếp. Hãy nhân bản (Clone) để tạo phương án nháp mới.`
     - Vô hiệu hóa (disable) toàn bộ các trường nhập tọa độ, tham số kỹ thuật, liên kết chỉ huy và nút xóa khí tài.
3. **Màn hình khi chưa chọn khí tài (Empty State)**:
   - Hiển thị thẻ tóm tắt phương án hiện tại: Tên kịch bản, Tên phương án, Phiên bản, Tổng số khí tài đang bố trí, Trạng thái phê duyệt.

### 6.4. Kho Khí Tài & Biên Chế ([LeftSidebar.tsx](file:///e:/vompk/vomkq-web/src/components/ui/LeftSidebar.tsx))
- Khi `activePlan.status !== 'draft'`:
  - Hiển thị banner nhỏ cảnh báo: `"Phương án đã khóa — nhân bản để tiếp tục đặt khí tài"`.
  - Vô hiệu hóa thao tác click chọn đặt khí tài mới từ Catalog.

---

## 7. BẢN ĐỒ CÁC FILE BỊ ẢNH HƯỞNG (LAYER & FILE IMPACT MAP)

```text
Domain / Types Layer (READ-ONLY - Không sửa đổi)
  ├── src/domain/types/scenario.ts (Giữ nguyên)
  ├── src/domain/types/plan.ts (Giữ nguyên)
  └── src/domain/types/audit.ts (Giữ nguyên)

Application / Store Layer
  └── src/store/useTacticalStore.ts (CHỈNH SỬA)
      ├── Khai báo actions: createScenario, switchScenario, renameScenario
      ├── Khai báo actions: createEmptyPlan, renamePlan, proposePlan
      ├── Cập nhật switchActivePlan & createPlanAlternative (reset selection & purge transient calculation cache)
      ├── Cập nhật validateMutationGuard kiểm tra chặn toàn bộ mutation khi plan !== 'draft'
      └── Khai báo UI state: showWorkspaceModal, workspaceModalTab

UI / Presentation Layer
  ├── src/components/ui/WorkspaceModal.tsx (FILE MỚI: Modal quản lý Kịch bản & Phương án 2 tab)
  ├── src/components/ui/TopBar.tsx (CHỈNH SỬA: Badges ngữ cảnh + Quick Switcher + Nút mở modal)
  ├── src/components/ui/RightInspector.tsx (CHỈNH SỬA: Context header + Read-only banner + disable form)
  ├── src/components/ui/LeftSidebar.tsx (CHỈNH SỬA: Cảnh báo & disable đặt khí tài khi plan đã khóa)
  └── src/App.tsx (CHỈNH SỬA: Mount <WorkspaceModal />)

Map / 3D Visualization Layer (READ-ONLY - Không sửa đổi)
  └── src/components/map/CesiumGlobe.tsx (Tự động reactive qua selector selectActiveEquipment)

Testing Layer
  └── src/store/workspaceIntegration.test.ts (FILE MỚI: Test tích hợp duy nhất cho Checkpoint 2A)
```

---

## 8. CHÍNH SÁCH TEST & HÀNH TRÌNH KIỂM CHỨNG (TEST JOURNEY)

### 8.1. Ràng buộc Test Nghiêm ngặt
- **DUY NHẤT MỘT** file test tích hợp: `src/store/workspaceIntegration.test.ts`.
- Không tạo test file phụ, không tạo test cho từng helper riêng lẻ.
- **Giữ nguyên toàn bộ 112 tests cũ**; không sửa, xóa, skip hoặc làm yếu bất kỳ assertion nào.
- UI/2D/3D được nghiệm thu bằng **Manual Smoke Checklist** thực tế, không tuyên bố Store test chứng minh toàn bộ UI.

### 8.2. Kịch bản Test Tích hợp Toàn diện (`workspaceIntegration.test.ts`)
Một test case chính duy nhất kiểm tra toàn bộ vòng đời và các bất biến:
```typescript
describe('Checkpoint 2A: Scenario / Plan Workspace Full Lifecycle Integration', () => {
  it('executes full flow: create Scenario -> Plan A -> clone Plan B -> edit B -> switch A/B -> verify isolation -> propose B -> export/import -> createEmptyPlan -> switchScenario -> test archived read-only', () => {
    // Giai đoạn 1: Tạo Scenario mới S1
    // - Gọi createScenario('Kịch Bản Phòng Không Hà Nội', 'v1') -> s1Id
    // - Assert activeScenarioId === s1Id
    // - Assert tồn tại Baseline Plan A với version === 1, status === 'draft'
    // - Assert activePlanId === planAId
    // - Assert selectedInstanceId === null

    // Giai đoạn 2: Thêm khí tài vào Plan A
    // - Thêm 1 đài radar 36D6 và 1 sở chỉ huy C2
    // - Assert selectActiveEquipment trả về 2 khí tài có planId === planAId
    // - Assert definitions của 2 khí tài có planId === planAId

    // Giai đoạn 3: Nhân bản Plan A thành Alternative Plan B
    // - Gọi createPlanAlternative(planAId) -> planBId
    // - Assert activePlanId === planBId
    // - Assert Plan B có version === 2, status === 'draft'
    // - Assert placements và definitions của Plan B có ID hoàn toàn mới
    // - Assert selectedInstanceId === null (đã reset)
    // - Assert revisionHeads chứa bản ghi BRANCH cho Plan B có derivedFromRevisionId trỏ về Plan A

    // Giai đoạn 4: Chỉnh sửa Plan B
    // - Đổi tên Plan B thành "Phương Án Bố Trí Phân Tán" (renamePlan)
    // - Cập nhật tọa độ đài radar trong Plan B
    // - Thêm 1 đài Kolchuga mới vào Plan B
    // - Assert selectActiveEquipment trả về 3 khí tài

    // Giai đoạn 5: Chuyển đổi qua lại giữa Plan A và Plan B (Plan Isolation Verification)
    // - switchActivePlan(planAId):
    //   + Assert selectActiveEquipment chỉ trả về 2 khí tài ban đầu
    //   + Assert tọa độ đài radar trong Plan A HOÀN TOÀN KHÔNG ĐỔI (Chứng minh cô lập dữ liệu)
    // - switchActivePlan(planBId):
    //   + Assert selectActiveEquipment trả về 3 khí tài với tọa độ mới

    // Giai đoạn 6: Đề xuất xét duyệt Plan B (Lifecycle Freeze & Mutation Guard)
    // - Gọi proposePlan(planBId)
    // - Assert Plan B chuyển sang status === 'proposed'
    // - Thử thêm khí tài mới vào Plan B -> Bắt buộc ném lỗi validateMutationGuard
    // - Thử cập nhật tọa độ khí tài trong Plan B -> Bắt buộc ném lỗi validateMutationGuard
    // - Thử đổi tên Plan B -> Bắt buộc ném lỗi do không còn là 'draft'

    // Giai đoạn 7: Tạo Phương Án Trắng Mới (createEmptyPlan)
    // - Gọi createEmptyPlan('Phương Án Dự Bị Trắng') -> planCId
    // - Assert activePlanId === planCId
    // - Assert selectActiveEquipment trả về mảng rỗng []
    // - Assert plan C có version === 1, status === 'draft'

    // Giai đoạn 8: Xuất và Nạp Canonical Package (Export & Import Roundtrip)
    // - const pkg = exportCanonicalPackage('Gói Kiểm Tra 2A')
    // - Assert pkg.scenarios[s1Id] và pkg.plans[planBId] tồn tại
    // - importCanonicalPackage(pkg)
    // - Assert workspace phục hồi nguyên vẹn S1, Plan A, Plan B và các placements
    // - Assert có Audit Event với action === 'IMPORT' và targetType === 'WORKSPACE'

    // Giai đoạn 9: Chuyển Kịch Bản & Kiểm tra Kịch Bản Lưu Trữ (Archived Read-Only Guard)
    // - Tạo thêm Scenario S2 (Archived)
    // - switchScenario(s2Id):
    //   + Assert activeScenarioId === s2Id
    //   + Assert lựa chọn Plan deterministic theo thứ tự version/ID
    // - Thử thêm khí tài vào kịch bản S2 -> Bắt buộc ném lỗi validateMutationGuard do Scenario đã archived
  });
});
```

---

## 9. ĐÁNH GIÁ RỦI RO & BIỆN PHÁP PHÒNG NGỪA (RISK ASSESSMENT)

| Rủi ro tiềm ẩn | Mức độ | Biện pháp phòng ngừa chi tiết |
| :--- | :---: | :--- |
| **Rò rỉ con trỏ chọn khí tài cũ (Stale selection leak)** | Trung bình | `switchActivePlan`, `switchScenario` và `createPlanAlternative` luôn bắt buộc gán `selectedInstanceId: null`. |
| **Rò rỉ cache tính toán tạm (Calculation cache pollution)** | Trung bình | Purge triệt để `coverageVolumes`, `spxResults`, `samVolumes` khi chuyển Plan; giữ nguyên `samEngagementModes` người dùng đã chọn. |
| **Ô nhiễm kết quả bất đồng bộ (Async race condition)** | Trung bình | Xác minh `requestPlanId === state.activePlanId` trước khi ghi nhận kết quả bất đồng bộ. |
| **Ghi đè chéo giữa các phương án (Cross-plan mutation)** | Cao | Placements/Definitions khi clone có ID hoàn toàn mới; các hàm mutation luôn kiểm tra `p.planId === state.activePlanId`. |
| **Sửa nhầm phương án đã khóa (Mutating proposed plan)** | Cao | Đặt `validateMutationGuard` tại toàn bộ mutation entry points ở Store, không chỉ chặn trên nút bấm UI. |
| **Lỗi schema khi import package** | Nghiêm ngặt | Giữ nguyên Schema Version 1 của CanonicalStatePackage (đủ 11 trường), không thêm các trường schema ngoài luồng. |
| **Gãy 112 tests hồi quy cũ (Regression)** | Nghiêm ngặt | Không sửa code trong các test cũ; chỉ bổ sung actions mới có tính tương thích ngược tuyệt đối. |

---

## 10. DEFINITION OF DONE & TIÊU CHÍ NGHIỆM THU (DOD)

Checkpoint 2A chỉ được coi là hoàn thành khi đạt đủ tất cả các tiêu chí sau:

### 10.1. Kiểm thử Kỹ thuật (Automated Gates)
1. [ ] **Store Actions hoàn chỉnh**: `createScenario`, `switchScenario`, `renameScenario`, `createEmptyPlan`, `renamePlan`, `proposePlan`, `switchActivePlan`, `saveActivePlan`, `createPlanAlternative` hoạt động chuẩn xác theo spec.
2. [ ] **Test Tích hợp Duy nhất**: `src/store/workspaceIntegration.test.ts` hoàn thành và **PASS 100%**.
3. [ ] **Hồi quy Suite cũ**: Toàn bộ **112 tests cũ tiếp tục PASS 100%** (tổng cộng 113+ tests PASS).
4. [ ] **Kiểm tra Kiểu (TypeScript)**: `npx tsc -b --pretty false` đạt **0 lỗi**.
5. [ ] **Quy trình Kiểm thử theo tầng**: Chạy focused tests trong khi triển khai; chạy một full gate (full 113+ tests, tsc, npm run build) tại thời điểm source code đã hoàn toàn ổn định.
6. [ ] **Tuân thủ Git & Governance**: Không tự tiện `git add`, `commit`, `push`, `checkout`, `reset` hoặc `clean`.

### 10.2. Kiểm thử Thủ công Giao diện & Trực quan (Manual UI Smoke Checklist)
1. [ ] **Mở Workspace Modal**: Nhấp nút `"Không Gian Tác Chiến"` trên TopBar $\to$ Modal mở mượt mà với 2 Tab.
2. [ ] **Tạo Kịch bản & Phương án**: Tạo kịch bản mới $\to$ Tự động chuyển kịch bản và sinh Baseline Plan.
3. [ ] **Chuyển đổi Phương án trên TopBar**: Dùng Quick Plan Switcher chuyển giữa Plan A và Plan B $\to$ Quan sát Cesium Globe unmount các khí tài cũ và mount đúng khí tài của phương án mới; 2D/3D đồng bộ hoàn hảo.
4. [ ] **Khóa Phương án (Read-Only)**: Đề xuất phương án $\to$ Kiểm tra RightInspector hiển thị Read-Only banner và vô hiệu hóa form sửa; LeftSidebar cảnh báo khóa đặt khí tài.
5. [ ] **Không còn tham chiếu mồ côi**: Khi đổi phương án, Inspector tự động chuyển về trạng thái tóm tắt phương án (không hiển thị khí tài của phương án trước).

---

## 11. KẾ HOẠCH XỬ LÝ LỖI (MINI FIX PLAN PROCEDURE)

Nếu trong quá trình triển khai gặp lỗi biên dịch hoặc test fail:
1. **DỪNG VIỆC SỬA MÒ NGAY LẬP TỨC**.
2. **Lập Mini Fix Plan theo mẫu**:
   - **Symptom**: Triệu chứng lỗi cụ thể (test fail ở assertion nào, stack trace).
   - **Root Cause**: Nguyên nhân gốc rễ (vi phạm contract, thiếu guard, hay sai lệch ID).
   - **Affected Contract**: Hợp đồng dữ liệu bị ảnh hưởng.
   - **Minimal Fix**: Đoạn sửa đổi tối thiểu, đúng trọng tâm.
   - **Verification**: Chạy lại focused test để kiểm chứng.
3. Nếu cùng một lỗi không tiến triển qua hai lượt sửa, dừng lại và báo blocker thay vì lặp vô hạn.

---

## 12. FINAL CONTRACT ADDENDUM (TỔNG HỢP CÁC BỔ SUNG THEO YÊU CẦU REVIEW)

Phần này tổng hợp trực tiếp các điều chỉnh hợp đồng kỹ thuật bắt buộc theo kết quả Independent Review:

1. **Ràng buộc `switchScenario`**:
   - `switchScenario` **không tự tạo Baseline Plan ngầm** khi chuyển sang kịch bản khác.
   - Nếu kịch bản có các plans: Áp dụng quy tắc deterministic `matchingPlans.sort((a,b) => a.version - b.version || a.id.localeCompare(b.id))[0]`.
   - Nếu kịch bản rỗng: `activePlanId = null`, `selectedInstanceId = null`, UI hiển thị Empty State hợp lệ.
   - Kịch bản `archived`: Luôn là Read-Only toàn phần, không bao giờ phát sinh mutation ngầm.
2. **Phân định Context Isolation**:
   - **Canonical business data**: Không bao giờ xóa trên global registry khi chuyển Plan.
   - **User configuration**: Cấu hình chế độ tác chiến SAM `samEngagementModes` được lưu theo `placementId`, **không bị xóa** khi chuyển Plan.
   - **Derived / Transient cache**: Chỉ xóa các cache dẫn xuất (`coverageVolumes`, `spxResults`, `samVolumes`).
   - `terrainVersion`: Là metadata xuất xứ của kịch bản hiển thị trên giao diện và gói package, không chuyển đổi runtime Cesium engine ở 2A.
3. **Cách ly Tác vụ Bất đồng bộ (Async Isolation)**:
   - Các tác vụ bất đồng bộ (Cesium sampling, SPx, AI advisor) phải kiểm tra `requestPlanId === state.activePlanId` trước khi ghi kết quả. Bỏ qua kết quả nếu context đã thay đổi.
4. **Chính sách Một Test (One-Test Policy)**:
   - File `workspaceIntegration.test.ts` chứa duy nhất một test case chính kiểm tra toàn bộ luồng, có bổ sung các bước `createEmptyPlan`, `switchScenario` và kiểm tra kịch bản `archived`.
   - Giữ nguyên 112 tests cũ. Nghiệm thu UI/2D/3D bằng Manual Smoke Checklist.
5. **Điều chỉnh Nhỏ**:
   - `CanonicalStatePackageV1` chứa đúng 11 trường dữ liệu.
   - Đối chiếu Audit API và types thực tế trước khi viết code.
   - Quy trình test: Chạy focused test trong khi code, và chạy một full gate (full 113+ tests + tsc + build) khi code đã ổn định.

---

**KẾT LUẬN & BƯỚC TIẾP THEO**:  
Bản Implementation Plan 2A v2 REVISED + FINAL CONTRACT ADDENDUM đã được hoàn thiện đầy đủ.  
Toàn bộ mã nguồn sản phẩm **CHƯA ĐƯỢC CHỈNH SỬA** trước khi nhận được sự phê duyệt chính thức (Human Approval) từ Người dùng.
