# KIM CHỈ NAM PHÁT TRIỂN PHẦN MỀM MÔ PHỎNG / HỖ TRỢ LẬP KẾ HOẠCH PHÒNG KHÔNG

**Tên tài liệu:** Kim chỉ nam và đích đến cuối cùng của dự án  
**Định dạng:** Markdown  
**Phiên bản:** 2.0  
**Trạng thái:** Master Plan / North Star / Scenario Simulation Decision-Support  
**Mục đích:** Định hướng kiến trúc, sản phẩm, dữ liệu, mô phỏng, giao diện và quy trình phát triển dài hạn cho hệ thống web mô phỏng bố trí khí tài trên địa hình 2D/3D.

---

## 0. TÓM TẮT ĐIỀU HÀNH

Dự án không nên phát triển theo hướng đơn giản là:

> **“Một bản đồ có các marker khí tài và một chế độ 3D để hiển thị cho đẹp.”**

Đích đến của phiên bản North Star 2.0 là:

> **Một môi trường mô phỏng địa không gian cho phép xây dựng nhiều kịch bản, tạo và so sánh các phương án mô phỏng, chạy simulation có kiểm soát, đánh giá kết quả, tổ chức review của con người, lưu quyết định và tái hiện lại toàn bộ quá trình.**

Điểm thay đổi quan trọng nhất so với v1.0:

**Scenario/Simulation không còn là module phụ. Nó trở thành trục vận hành trung tâm của sản phẩm.**

Người dùng phải có thể đi theo vòng lặp:

```text
              DATA / BASELINE
                     ↓
             BUILD SCENARIO
                     ↓
          CREATE ALTERNATIVES
                     ↓
               SIMULATE
                     ↓
         ASSESS OUTCOMES + LIMITS
                     ↓
          HUMAN REVIEW / DISCUSSION
                     ↓
           RECORD DECISION / PLAN
                     ↓
          RE-RUN / STRESS TEST / REPLAY
                     ↺
```

Trong bối cảnh mô phỏng huấn luyện, một scenario có thể chứa các thực thể hàng không/“aerial threat” do người dùng tạo để kiểm tra cách mô hình phản ứng. Kết quả phải là **kết quả mô phỏng có thể giải thích và kiểm tra**, không phải chỉ là một animation hay một phán quyết tự động.

### North Star mới

```text
ONE SHARED MODEL
       ↓
SCENARIO / PLAN
       ↓
SIMULATION
       ↓
ASSESSMENT
       ↓
COMPARE ALTERNATIVES
       ↓
HUMAN REVIEW
       ↓
DECISION RECORD
       ↓
REPLAY / LEARN
```

### Ba nguyên tắc đích đến

1. **Model before render:** dữ liệu và trạng thái là nguồn sự thật; 2D/3D/Inspector chỉ là các view.
2. **Simulate before conclude:** mọi kết luận phải xuất phát từ scenario, input, configuration và analysis/simulation result có version.
3. **Human before action:** phần mềm trình bày bằng chứng, giả định, độ tin cậy và trade-off để con người review; không tự điều khiển hay tự ra lệnh sử dụng vũ khí.

### Phạm vi an toàn

Tài liệu này định hướng **mô phỏng, huấn luyện, nghiên cứu, đánh giá hệ thống, nhận thức tình huống và hỗ trợ review**. Không đặc tả việc tự động hóa hay tối ưu hoá quyết định tác chiến thực tế, điều khiển hỏa lực, chỉ thị mục tiêu hoặc lệnh sử dụng vũ khí.

---

# 1. VÌ SAO PHẢI THAY ĐỔI TƯ DUY SẢN PHẨM?

## 1.1. Mô hình “đặt marker” là chưa đủ

Một ứng dụng bản đồ thông thường có thể có:

```text
Equipment
├── id
├── type
├── longitude
├── latitude
└── label
```

Cách này phù hợp với một bản đồ quản lý vị trí, nhưng không đủ cho một hệ thống mô phỏng / lập kế hoạch.

Một đối tượng nên được hiểu là một thực thể có **vòng đời** và **ngữ cảnh**:

```text
Equipment
├── Identity
├── Classification
├── Location / Geometry
├── Planned State
├── Observed State
├── Operational Metadata
├── Scenario Membership
├── Dependencies / Relationships
├── Analysis Inputs
├── Analysis Outputs
└── History / Audit
```

## 1.2. Không được gộp “kế hoạch” với “thực tế”

Một trong những thay đổi kiến trúc quan trọng nhất của toàn dự án là tách:

```text
PLAN / MODEL
      ≠
OBSERVED / ACTUAL STATE
```

Ví dụ phần mềm có thể có một đối tượng:

```text
RADAR-01

planned:
    status = proposed
    position = P1

observed:
    status = unknown
    position = unknown
```

Sau khi người dùng cập nhật dữ liệu thực tế trong môi trường mô phỏng:

```text
RADAR-01

planned:
    status = approved
    position = P1

observed:
    status = confirmed
    position = P2
```

Hệ thống khi đó không tự thay đổi lịch sử kế hoạch. Nó hiển thị **plan/observed difference**.

## 1.3. Mọi kết quả phân tích đều phải có “ngữ cảnh”

Không được lưu một kết quả kiểu:

```text
coverage = 82%
```

mà không biết kết quả đó được tạo từ:

- địa hình phiên bản nào;
- dữ liệu đối tượng phiên bản nào;
- tham số mô phỏng nào;
- kịch bản nào;
- thời điểm nào;
- thuật toán phiên bản nào;
- người dùng nào;
- dữ liệu đầu vào có thiếu hay không.

Thay vào đó:

```text
AnalysisResult
├── scenarioId
├── terrainDatasetVersion
├── modelVersion
├── configurationSnapshot
├── algorithmVersion
├── timestamp
├── confidence / data-quality metadata
└── result
```

Mục tiêu là **reproducibility**: cùng dữ liệu và cùng cấu hình phải có thể giải thích tại sao hệ thống tạo ra kết quả đó.

---

# 2. TẦM NHÌN CUỐI CÙNG CỦA DỰ ÁN

## 2.1. North Star

### “Một môi trường mô phỏng địa không gian có khả năng chuyển từ bản đồ → mô hình → phương án → phân tích → so sánh → đánh giá → lịch sử.”

Không coi 2D và 3D là hai sản phẩm khác nhau.

Không coi radar coverage là một hiệu ứng đồ họa.

Không coi Inspector chỉ là bảng sửa thuộc tính.

Không coi equipment chỉ là marker.

Tất cả phải là những cách nhìn khác nhau trên **cùng một mô hình dữ liệu có ngữ cảnh**.

## 2.2. Câu hỏi mà sản phẩm cuối cùng phải trả lời được

Một người dùng mở một scenario và phải có khả năng hiểu nhanh:

> “Tôi đang xem khu vực nào?”  
> “Đang ở trạng thái kế hoạch hay trạng thái quan sát?”  
> “Những đối tượng nào đang tham gia scenario?”  
> “Dữ liệu nào là chắc chắn, dữ liệu nào chỉ là giả định?”  
> “Phân tích hiện tại dựa trên cấu hình nào?”  
> “Điểm nào cần được kiểm tra lại?”  
> “Tôi vừa thay đổi gì?”  
> “Hai phương án khác nhau như thế nào?”

Đó là đích đến sản phẩm.

---

# 3. NGUYÊN TẮC THIẾT KẾ BẮT BUỘC

## 3.1. Model-first

Không xây UI trước rồi mới nghĩ dữ liệu.

Trình tự:

```text
Domain Model
    ↓
Application State
    ↓
Analysis Contract
    ↓
UI
    ↓
Visualization
```

## 3.2. State-first

Mọi thao tác quan trọng phải làm thay đổi một trạng thái rõ ràng.

Ví dụ:

```text
Draft
→ Proposed
→ Approved
→ Simulated
→ Reviewed
→ Archived
```

Không sử dụng các cờ boolean rời rạc khi một đối tượng thực chất có lifecycle.

## 3.3. 2D và 3D phải dùng chung dữ liệu

```text
                     DOMAIN MODEL
                           │
             ┌─────────────┴─────────────┐
             ↓                           ↓
           2D MAP                     3D VIEW
             │                           │
          symbols                    terrain
          labels                     volumes
          relations                  cross-sections
          status                     analysis
```

Không cho phép có một “bộ dữ liệu 2D” và “bộ dữ liệu 3D” độc lập khiến hai giao diện lệch nhau.

## 3.4. Analysis phải tách khỏi Rendering

Ví dụ:

```text
radarMath.ts          → logic / model
radarLosEngine.ts     → analysis
radarGeometryBuilder.ts → geometry preparation
CesiumGlobe.tsx       → rendering
```

Renderer không được trở thành nơi chứa thuật toán nghiệp vụ.

## 3.5. Human-in-the-loop

Hệ thống có thể:

- tính toán;
- cảnh báo;
- so sánh;
- trực quan hóa;
- giải thích;
- gợi ý cần kiểm tra dữ liệu.

Nhưng quyết định cuối cùng phải thuộc về người dùng có thẩm quyền trong phạm vi sử dụng dự kiến.

## 3.6. Không có “magic result”

Không hiển thị:

```text
“Phương án này tốt nhất.”
```

nếu không có giải thích.

Nên hiển thị:

```text
Evaluation
├── criterion A → result
├── criterion B → result
├── data quality → warning
├── assumptions → list
└── limitations → list
```

## 3.7. Fail-safe visualization

Nếu dữ liệu không đủ để phân tích, hệ thống phải nói rõ:

```text
ANALYSIS INCOMPLETE
Reason:
- terrain resolution insufficient
- object parameter missing
- scenario input incomplete
```

Không được âm thầm tạo kết quả nhìn có vẻ chính xác.

---

# 4. KIẾN TRÚC KHÁI NIỆM TOÀN HỆ THỐNG

```text
┌─────────────────────────────────────────────────────────────────┐
│                         USER WORKSPACE                          │
│  2D Map │ 3D Terrain │ Inspector │ Scenario │ Compare │ Review │
├─────────────────────────────────────────────────────────────────┤
│                      APPLICATION LAYER                          │
│ Scenario Service │ Plan Service │ Simulation Service            │
│ Analysis Service │ Review Service │ History / Audit             │
├─────────────────────────────────────────────────────────────────┤
│                         DOMAIN MODEL                            │
│ Equipment │ Site │ Scenario │ Plan │ Observation │ Threat Model  │
│ Event │ Assumption │ AnalysisResult │ SimulationRun │ Decision  │
├─────────────────────────────────────────────────────────────────┤
│                    COMPUTATION / SIMULATION                     │
│ Terrain Processing │ Geometry │ Visibility │ Statistics          │
│ Scenario Simulation │ Result Aggregation │ Difference/Compare   │
├─────────────────────────────────────────────────────────────────┤
│                            DATA                                  │
│ Terrain │ Equipment Profiles │ Scenario Packages │ Result Store │
│ Dataset Metadata │ Version Manifests │ Audit Log                │
└─────────────────────────────────────────────────────────────────┘
```

### Luồng trung tâm của sản phẩm

```text
Scenario Baseline
      ↓
Plan / Alternative
      ↓
Validation
      ↓
Simulation Run
      ↓
Result Snapshot
      ↓
Assessment
      ↓
Human Review
      ↓
Decision Record
      ↓
Next Scenario / New Alternative
```

**Mục tiêu:** Không có module nào tự tạo “sự thật” riêng. Scenario là context; Plan là một versioned proposal; SimulationRun là một lần thực thi tái hiện được; Assessment là phần giải thích kết quả; Decision Record lưu kết luận của con người.

### Nguyên tắc kiến trúc

Có thể thay UI mà không phải viết lại domain.

Có thể thay renderer mà không phải viết lại analysis/simulation.

Có thể chạy simulation mà không cần Cesium.

Có thể replay một scenario từ snapshot/event history mà không cần đoán lại trạng thái từ UI.

Có thể mở hai alternative trong cùng một scenario campaign và so sánh theo cùng một bộ tiêu chí.

---

# 5. DOMAIN MODEL: HỆ THỐNG PHẢI HIỂU NHỮNG GÌ?

## 5.1. Equipment

Mỗi khí tài / cảm biến / trạm trong mô phỏng có:

```text
Equipment
├── id
├── name
├── category
├── modelType
├── symbol
├── geometry
├── plannedState
├── observedState
├── metadata
├── scenarioIds
├── analysisProfileId
└── auditHistory
```

Không nhét toàn bộ thông tin vào một interface khổng lồ.

Nên chia profile:

```text
EquipmentIdentity
EquipmentGeometry
EquipmentOperationalState
EquipmentAnalysisProfile
EquipmentVisualizationProfile
EquipmentAudit
```

## 5.2. Site

Tách “đối tượng” khỏi “vị trí tổ chức / địa điểm”.

```text
Site
├── id
├── geometry
├── terrainReference
├── siteMetadata
├── assignedEquipmentIds
└── observations
```

Điều này giúp một site có thể tồn tại ngay cả khi equipment được thay đổi.

## 5.3. Scenario

Scenario là đơn vị mô phỏng quan trọng nhất.

```text
Scenario
├── id
├── name
├── description
├── areaOfInterest
├── terrainVersion
├── environmentVersion
├── equipmentSnapshot
├── observationSnapshot
├── assumptions
├── constraints
├── analysisConfig
├── timeline
├── author
├── createdAt
├── updatedAt
└── status
```

Một project có thể có nhiều scenario:

```text
Scenario A — baseline
Scenario B — alternative
Scenario C — degraded data
Scenario D — training exercise
Scenario E — post-event replay
```

## 5.4. Plan

Plan là một “ảnh chụp có chủ đích” của một trạng thái bố trí/ý tưởng mô phỏng.

```text
Plan
├── id
├── scenarioId
├── version
├── author
├── createdAt
├── status
├── assumptions
├── objectSnapshot
├── analysisSnapshot
└── reviewNotes
```

Không sửa trực tiếp lịch sử cũ.

Thay đổi lớn tạo version mới:

```text
Plan v1
   ↓
Plan v2
   ↓
Plan v3
```

## 5.5. Observation

Observation không có nghĩa là “sự thật tuyệt đối”.

Nó là dữ liệu được nhập/ghi nhận.

```text
Observation
├── source
├── timestamp
├── confidence
├── geometry
├── status
├── note
└── validityWindow
```

Điều này cho phép mô phỏng các tình huống dữ liệu không hoàn hảo.

## 5.6. Event

Mọi thay đổi quan trọng đều phải có event:

```text
Event
├── id
├── timestamp
├── actor
├── action
├── objectId
├── before
├── after
└── reason
```

Ví dụ ở mức phần mềm:

```text
equipment.updated
scenario.created
plan.version.created
analysis.executed
observation.updated
terrain.dataset.changed
```

---

# 6. VÒNG ĐỜI PHƯƠNG ÁN

Đây là một trong những thành phần phải được hoàn thiện sớm.

```text
DRAFT
  ↓
PROPOSED
  ↓
REVIEWED
  ↓
APPROVED_FOR_SIMULATION
  ↓
SIMULATED
  ↓
ASSESSED
  ↓
ARCHIVED
```

Có thể có nhánh:

```text
PROPOSED
   ↓
REJECTED
   ↓
REVISED
   ↓
PROPOSED
```

### Quy tắc

Không xoá lịch sử bằng cách ghi đè.

Không biến “Approved” thành “Draft” mà không có event.

Không cho phép kết quả simulation cũ tự động đại diện cho plan mới.

Mọi analysis result phải gắn với **exact plan version**.

---

# 7. VÒNG ĐỜI ĐỐI TƯỢNG

Đối tượng không nên chỉ có `isActive`.

Một lifecycle có thể là:

```text
CREATED
   ↓
PLANNED
   ↓
PROPOSED
   ↓
CONFIRMED
   ↓
OBSERVED
   ↓
DEGRADED
   ↓
UNAVAILABLE
   ↓
ARCHIVED
```

Tên trạng thái nên được chuẩn hóa trong domain layer thay vì viết string tùy ý ở UI.

---

# 8. 2D MAP PHẢI TRỞ THÀNH “COMMANDER OVERVIEW” Ở MỨC MÔ PHỎNG

Bản đồ 2D không cần hiển thị mọi chi tiết kỹ thuật.

Nó phải trả lời nhanh:

```text
WHAT?
WHERE?
STATUS?
RELATION?
CHANGE?
WARNING?
```

### Nguyên tắc visual hierarchy

1. Khu vực / địa hình.
2. Nhóm đối tượng chính.
3. Trạng thái.
4. Quan hệ.
5. Phân tích.
6. Chi tiết kỹ thuật.

Không để 20 loại icon có cùng trọng lượng thị giác.

### Symbol system

Mỗi category có:

```text
symbol
shape
label rules
status indicator
selection state
error/warning state
```

Không dùng màu như nguồn thông tin duy nhất.

Mọi trạng thái quan trọng phải có ít nhất hai phương thức biểu đạt:

```text
color + icon
color + text
opacity + state badge
```

---

# 9. 3D KHÔNG PHẢI CHẾ ĐỘ TRANG TRÍ

3D phải phục vụ việc hiểu không gian.

### 3D có 4 lớp chính

```text
1. TERRAIN
2. OBJECTS
3. ANALYSIS / VOLUMES
4. ANNOTATION
```

Ví dụ:

```text
Terrain
   ↓
Equipment position
   ↓
Observation / analysis volume
   ↓
Terrain interaction
   ↓
Cross-section
```

### Những việc 3D phải làm tốt

- xem địa hình theo góc nhìn tự do;
- chuyển nhanh giữa overview và inspection;
- thấy được chênh lệch cao độ;
- thấy vùng phân tích trong không gian;
- xem cross-section khi chọn đối tượng;
- bật/tắt các layer;
- giữ đồng bộ với selection trong 2D;
- không tạo ra dữ liệu riêng biệt với 2D.

---

# 10. TERRAIN ENGINE

Terrain là nền tảng của toàn hệ thống, không phải texture.

## 10.1. Terrain dataset phải có metadata

```text
TerrainDataset
├── id
├── source
├── resolution
├── coordinateReferenceSystem
├── verticalReference
├── acquisitionDate
├── processingVersion
├── bounds
├── noDataPolicy
└── qualityFlags
```

## 10.2. Phải phân biệt

```text
terrain visual quality
        ≠
terrain analysis quality
```

Một terrain nhìn rất đẹp có thể không đủ dữ liệu cho một phép phân tích.

## 10.3. Quality badge

Hiển thị cho người dùng:

```text
Terrain quality: HIGH
```

hoặc:

```text
Terrain quality: LIMITED
Reason: coarse resolution
```

---

# 11. ANALYSIS ENGINE — NGUYÊN TẮC AN TOÀN VÀ KIẾN TRÚC

Analysis engine phải được thiết kế như một hệ thống toán học độc lập với UI.

```text
Input Snapshot
      ↓
Validation
      ↓
Analysis
      ↓
Result
      ↓
Explanation
      ↓
Visualization
```

Mỗi phép phân tích phải khai báo:

```text
AnalysisDefinition
├── id
├── version
├── requiredInputs
├── optionalInputs
├── limitations
├── qualityChecks
├── outputSchema
└── rendererHints
```

### Bắt buộc có validation trước khi chạy

```text
CanRunAnalysis?
```

Ví dụ:

```text
NO
Missing terrain dataset.
```

thay vì:

```text
YES → tạo một hình ảnh giả định trông có vẻ chính xác.
```

### Kết quả nên có

```text
AnalysisResult
├── status
├── resultData
├── confidenceMetadata
├── assumptions
├── warnings
├── limitations
├── inputsHash
├── algorithmVersion
└── generatedAt
```

---

# 12. RADAR / CẢM BIẾN: CÁCH ĐẶT TRONG KIẾN TRÚC SẢN PHẨM

Radar không nên được lập trình như một khối đặc biệt nằm trong `CesiumGlobe`.

Nên có:

```text
Sensor
├── SensorProfile
├── SensorVisualization
├── SensorAnalysisAdapter
└── SensorState
```

Sau đó radar chỉ là một specialization:

```text
Sensor
  └── RadarSensorProfile
```

### Coverage / visibility visualization

Nên coi vùng bao phủ là:

```text
ANALYSIS RESULT
```

rồi mới chuyển thành:

```text
3D geometry
```

không xây geometry trước rồi coi geometry là dữ liệu.

### Cross-section

Cross-section phải lấy từ cùng một result model:

```text
AnalysisResult
     ├── 3D visualization
     ├── 2D footprint
     └── Cross-section
```

Như vậy ba góc nhìn không thể tự ý cho ba kết quả khác nhau.

---

# 13. “PLAN VS OBSERVED” — CHỨC NĂNG PHẢI CÓ

Đây là một trong những tính năng tạo ra khác biệt lớn nhất giữa ứng dụng bản đồ và môi trường mô phỏng có kiểm soát.

### Chế độ

```text
PLAN
OBSERVED
COMPARE
```

### Compare view

```text
             PLAN           OBSERVED
Object A      ●                ●
Object B      ●                —
Object C      ●                ●
```

Từng khác biệt phải có:

```text
what changed
when changed
who changed
source
```

---

# 14. SCENARIO ENGINE

Scenario là “phòng thí nghiệm” của hệ thống.

Không chỉnh sửa trực tiếp một scenario đã dùng để đánh giá.

Tạo branch/copy:

```text
Scenario Base
      │
      ├── Scenario A
      ├── Scenario B
      └── Scenario C
```

### Scenario phải có

- baseline;
- assumptions;
- input snapshot;
- timeline;
- model version;
- result history;
- annotations;
- review state.

### Scenario comparison

Người dùng phải có thể mở hai scenario và xem:

```text
Objects changed
State changed
Input changed
Analysis changed
Warnings changed
```

Không chỉ so sánh hình ảnh.


---

# 14A. SCENARIO CAMPAIGN — MỘT LẦN “HỌP BÀN” TRÊN PHẦN MỀM

Scenario đơn lẻ chưa đủ. Người dùng cần một **Scenario Campaign** để tổ chức một chuỗi phương án cùng baseline và cùng tiêu chí đánh giá.

```text
CAMPAIGN
│
├── Baseline
├── Alternative A
├── Alternative B
├── Alternative C
├── Simulation Runs
├── Assessment Reports
├── Review Notes
└── Decision Record
```

## 14A.1. Mục tiêu

Phần mềm phải cho phép người dùng:

- bắt đầu từ một baseline;
- tạo nhiều alternative mà không phá baseline;
- chạy cùng bộ dữ liệu chuẩn để giảm sai lệch khi so sánh;
- lưu kết quả từng run;
- xem assumption/data-quality/limitation của từng phương án;
- tổ chức một phiên review;
- ghi lại phương án được chọn cho **mục đích mô phỏng/huấn luyện/đánh giá**.

## 14A.2. Không được “chọn winner” một cách mù

Sai:

```text
AI → Best Scenario = B
```

Đúng:

```text
Criteria
 + Results
 + Data Quality
 + Assumptions
 + Limitations
        ↓
Human Review
        ↓
Decision Record
```

Hệ thống có thể sắp xếp hoặc highlight các khác biệt đã tính toán, nhưng không biến một score duy nhất thành “mệnh lệnh”.

## 14A.3. Decision Record

```text
DecisionRecord
├── campaignId
├── comparedScenarioIds
├── selectedScenarioId
├── decisionAuthor
├── reviewedAt
├── rationale
├── assumptionsAcknowledged
├── limitationsAcknowledged
├── unresolvedQuestions
└── followUpActions
```

Đây là **bản ghi quyết định của con người**, không phải output tự động của engine.

---

# 14B. SIMULATION ENGINE — “PHÒNG THÍ NGHIỆM” CỦA SẢN PHẨM

Simulation engine là lớp chuyển một scenario tĩnh thành diễn biến theo thời gian.

```text
Scenario Snapshot
      ↓
Simulation Configuration
      ↓
Simulation Clock
      ↓
State Transitions / Events
      ↓
Result Collector
      ↓
Simulation Run
```

## 14B.1. SimulationRun

```text
SimulationRun
├── runId
├── campaignId
├── scenarioId
├── scenarioVersion
├── modelVersion
├── simulationVersion
├── configSnapshot
├── randomSeed (nếu dùng)
├── startedAt
├── completedAt
├── status
├── eventCount
├── resultSummary
└── diagnostics
```

## 14B.2. Tách “world state” khỏi “render state”

```text
Simulation World State
        ↓
Event / State Transition
        ↓
Recorded State Snapshot
        ↓
2D / 3D Rendering
```

Cesium không được là simulation engine.

## 14B.3. Aerial threat entities trong training scenario

Hệ thống có thể có **thực thể hàng không mô phỏng** với:

```text
ThreatEntity
├── id
├── class/type
├── initialState
├── trajectory/model reference
├── timeline/events
├── simulation metadata
└── visualization profile
```

Ở lớp mô phỏng an toàn, engine chỉ cần mô hình hóa:

- sự xuất hiện của thực thể;
- trạng thái theo thời gian;
- quan sát/phát hiện/tracking ở mức mô phỏng;
- phản ứng của các thành phần mô hình;
- kết quả tổng hợp để đánh giá scenario.

Không đưa vào đây logic điều khiển hỏa lực, tự động chỉ thị mục tiêu hoặc tối ưu hóa việc sử dụng vũ khí thực tế.

---

# 14C. WHAT-IF / ALTERNATIVE ANALYSIS

Đây là lớp biến “một lần chạy” thành **thử nhiều kịch bản có phương pháp**.

Người dùng phải có thể xác định:

```text
BASELINE
   │
   ├── change A → Scenario A
   ├── change B → Scenario B
   └── change C → Scenario C
```

### Quy tắc thay đổi

Mỗi alternative phải ghi rõ:

```text
what changed
why changed
expected effect
which inputs are held constant
which inputs are intentionally varied
```

### So sánh công bằng

Nếu người dùng muốn so sánh A/B/C, hệ thống phải cảnh báo nếu:

- terrain dataset khác;
- version model khác;
- bộ tham số đánh giá khác;
- dữ liệu đầu vào có chất lượng khác;
- simulation seed/config khác trong trường hợp seed cần kiểm soát.

Kết luận phải phân biệt **“scenario khác nhau”** với **“thí nghiệm không cùng điều kiện”**.

---

# 14D. ASSESSMENT PIPELINE

Kết quả simulation không được nhảy thẳng thành “đạt/không đạt”.

```text
Simulation Result
      ↓
Integrity Check
      ↓
Data Quality Check
      ↓
Metric Aggregation
      ↓
Uncertainty / Limitation Annotation
      ↓
Assessment View
      ↓
Human Review
```

### Assessment nên có 5 lớp

```text
1. Outcome summary
2. Key changes
3. Assumptions
4. Data quality / uncertainty
5. Limitations / unresolved items
```

### Ví dụ output an toàn

```text
Scenario B
────────────────────────
Simulation: COMPLETE
Data quality: GOOD
Major warnings: 2
Result reproducible: YES
Key differences vs baseline: 4
Reviewer notes: 3
Decision: HUMAN REVIEW REQUIRED
```

Không dùng một số điểm tổng hợp duy nhất làm “quyết định tự động”.

---

# 15. DECISION SUPPORT — TỔNG HỢP BẰNG CHỨNG CHO CON NGƯỜI

Decision support của project phải được định nghĩa là:

```text
Context
+ Simulation
+ Analysis
+ Comparison
+ Data Quality
+ Uncertainty
+ Explanation
+ Human Review
```

## 15.1. Hệ thống không kết luận thay người

Phần mềm có thể:

- phát hiện thiếu dữ liệu;
- chạy simulation;
- tính metrics;
- so sánh alternative;
- hiển thị chênh lệch;
- đánh dấu stale/incomplete;
- tạo báo cáo;
- đề xuất câu hỏi cần review.

Nhưng quyết định cuối cùng trong scenario review phải được ghi bởi con người.

## 15.2. Decision workspace

```text
┌────────────────────────────────────────────────────────────┐
│ SCENARIO CAMPAIGN                                        │
├────────────────────────────────────────────────────────────┤
│ Baseline │ Alt A │ Alt B │ Alt C                        │
├──────────────────────────────┬─────────────────────────────┤
│ 2D / 3D context              │ Assessment                 │
│                              │ Outcome                    │
│ timeline / state             │ Data quality              │
│ analysis layers              │ Assumptions               │
│                              │ Limitations               │
├──────────────────────────────┴─────────────────────────────┤
│ Review notes │ Open questions │ Decision record           │
└────────────────────────────────────────────────────────────┘
```

## 15.3. Decision provenance

Một kết luận phải truy ngược được:

```text
Decision
  ↓
Assessment
  ↓
SimulationRun
  ↓
Scenario Version
  ↓
Plan / Input Snapshot
  ↓
Terrain + Dataset Versions
```

Nếu một mắt xích không còn truy cập được, UI phải báo `TRACEABILITY INCOMPLETE`.

## 15.4. Không che uncertainty

Nếu dữ liệu có giới hạn, assessment phải cho người dùng thấy giới hạn đó trước khi đưa ra review.

## 15.5. Không “AI magic”

AI sau này chỉ được hỗ trợ các việc như:

- tóm tắt scenario;
- giải thích khác biệt;
- tìm dữ liệu thiếu;
- gợi ý câu hỏi review;
- tạo báo cáo nháp;
- truy vấn dữ liệu bằng ngôn ngữ tự nhiên.

AI không được tự động chuyển simulation result thành hành động sử dụng vũ khí thực tế.

---

# 16. ALERT / WARNING SYSTEM

Không phải mọi cảnh báo đều có cùng mức độ.

Nên có severity:

```text
INFO
NOTICE
WARNING
CRITICAL DATA ISSUE
```

Ví dụ về phần mềm:

```text
WARNING
Analysis result is stale.
Current plan version: 7
Result generated from plan version: 6
```

Hoặc:

```text
DATA QUALITY
Terrain dataset does not cover the entire area of interest.
```

Điều này quan trọng hơn việc tô đỏ cả màn hình.

---

# 17. ĐỘ TIN CẬY VÀ ĐỘ HOÀN CHỈNH DỮ LIỆU

Mọi phân tích phải phân biệt:

```text
result
confidence
coverage of input data
assumptions
limitations
```

Không gọi mọi thứ là “accuracy”.

Ví dụ:

```text
Data completeness: 72%
Input quality: LIMITED
Model status: VALID WITH WARNINGS
```

Như vậy người sử dụng biết giới hạn của hệ thống.

---

# 18. AUDIT TRAIL

Nếu phần mềm hướng tới môi trường nghiêm túc, lịch sử là tính năng cốt lõi.

Phải lưu:

```text
who
what
when
before
after
why / note
```

Ví dụ:

```text
10:32
Operator A
Scenario #12
Changed terrain dataset
v3 → v4

10:35
Operator A
Executed analysis
Algorithm 2.3

10:41
Reviewer B
Approved scenario
```

### Không được

- xoá event lịch sử;
- sửa event cũ;
- thay đổi timestamp;
- để analysis result không có parent scenario.

---

# 19. REPLAY / AFTER-ACTION REVIEW

Đây là mục tiêu dài hạn cực kỳ quan trọng.

Hệ thống phải có khả năng:

```text
OPEN SCENARIO
    ↓
LOAD SNAPSHOT
    ↓
PLAY TIMELINE
    ↓
SEE CHANGES
    ↓
SEE ANALYSIS RESULTS
    ↓
SEE DECISION NOTES
```

Mục tiêu không phải “ghi lại video màn hình”.

Mục tiêu là **reconstructable state**.

Một scenario phải có thể mở lại và biết được hệ thống khi đó đã hiểu trạng thái như thế nào.

---

# 20. INSPECTOR — TÁI CẤU TRÚC THEO TƯ DUY “MISSION OBJECT”

Inspector hiện tại có xu hướng bị quá tải khi 2D, 3D và dữ liệu kỹ thuật cùng nhồi vào một panel.

Kiến trúc mới nên phân tầng:

```text
INSPECTOR
│
├── Overview
├── State
├── Spatial
├── Analysis
├── Scenario
├── History
└── Technical Details
```

### Khi chưa chọn đối tượng

Hiển thị:

```text
SCENARIO OVERVIEW
```

### Khi chọn một đối tượng

Hiển thị:

```text
OBJECT OVERVIEW
Status
Scenario role
Location
Data quality
Relevant analysis
Recent changes
```

### Chi tiết kỹ thuật chỉ mở khi cần

Không nên để người dùng luôn nhìn thấy hàng chục tham số.

---

# 21. SELECTION MODEL

2D, 3D và Inspector phải dùng chung một selection state.

```text
Global Selection
      │
      ├── 2D Map highlight
      ├── 3D Camera / highlight
      ├── Inspector detail
      └── Analysis panel
```

Chọn ở 2D → 3D theo cùng object.  
Chọn ở 3D → Inspector theo cùng object.

Không tạo:

```text
mapSelectedObject
cesiumSelectedObject
inspectorObject
```

nếu ba biến này có nguy cơ lệch nhau.

Nên có một nguồn sự thật:

```text
selectedEntityId
```

---

# 22. STATE MANAGEMENT

Store phải quản lý domain state, không nên biến thành “bãi chứa mọi thứ”.

Tách logic theo domain:

```text
useScenarioStore
useEquipmentStore
useSelectionStore
useAnalysisStore
useHistoryStore
useUIStore
```

UI state:

```text
panelOpen
cameraMode
layerVisibility
```

Domain state:

```text
equipment
scenario
plan
analysisResult
observation
```

Không trộn hai loại này nếu không cần thiết.

---

# 23. FILE / MODULE ORGANIZATION GỢI Ý

Cấu trúc mục tiêu:

```text
src/
├── domain/
│   ├── equipment/
│   ├── scenario/
│   ├── plan/
│   ├── observation/
│   ├── analysis/
│   └── audit/
│
├── application/
│   ├── scenario/
│   ├── planning/
│   ├── analysis/
│   ├── comparison/
│   └── replay/
│
├── analysis/
│   ├── terrain/
│   ├── geometry/
│   ├── visibility/
│   └── statistics/
│
├── visualization/
│   ├── map/
│   ├── globe/
│   ├── symbols/
│   ├── volumes/
│   └── crossSection/
│
├── components/
│   ├── map/
│   ├── inspector/
│   ├── scenario/
│   ├── analysis/
│   └── common/
│
├── store/
├── data/
├── types/
└── utils/
```

Không nhất thiết phải refactor toàn bộ ngay lập tức. Sử dụng cấu trúc này làm hướng đích.

---

# 24. CÁC LỚP CẦN TÁCH KHỎI CESIUM COMPONENT

`CesiumGlobe.tsx` chỉ nên chịu trách nhiệm chính về:

- lifecycle Cesium;
- camera;
- entity/primitive rendering;
- interaction;
- layer visibility;
- bridge tới domain selection.

Không nên để nó chứa:

- logic scenario;
- tính toán nghiệp vụ;
- quyết định trạng thái equipment;
- parse mọi loại dữ liệu;
- thuật toán phân tích terrain.

Mục tiêu:

```text
Cesium = Renderer
Domain = Meaning
Analysis = Computation
Store = State
Application = Orchestration
```

---

# 25. OFFLINE-FIRST

Do dự án có yêu cầu về khả năng làm việc với dữ liệu cục bộ, kiến trúc nên hỗ trợ offline-first.

### Nguyên tắc

```text
Local data
    ↓
Local scenario
    ↓
Local analysis
    ↓
Local result
```

Khi có backend:

```text
Local ↔ Sync ↔ Server
```

Nhưng scenario phải không phụ thuộc hoàn toàn vào mạng để mở và kiểm tra dữ liệu đã có.

### Offline package

Một scenario portable nên có:

```text
scenario.json
terrain metadata
object snapshot
analysis config
result snapshot
assets metadata
README / manifest
```

---

# 26. VERSIONING — BẮT BUỘC TỪ SỚM

Phải version hóa ít nhất:

```text
Scenario
Plan
Terrain Dataset
Analysis Algorithm
Equipment Profile
Configuration
```

Ví dụ:

```text
Terrain: DEM-v4
Analysis: LOS-v2.1
RadarProfile: RDR-Profile-v3
Scenario: SCN-12-v7
```

Khi có bug, người phát triển phải biết ngay:

```text
“Kết quả này được sinh bởi cấu hình nào?”
```

---

# 27. DEBUG-FIRST — QUY TẮC RIÊNG CHO DỰ ÁN NÀY

Đây là yêu cầu phải duy trì trong toàn bộ quá trình code.

### Mọi module quan trọng phải ghi rõ parameter quan trọng

Ví dụ comment:

```ts
/**
 * IMPORTANT PROJECT PARAMETERS
 * - Coordinates: WGS84
 * - Terrain vertical reference: project-defined datum
 * - Distances: meters internally
 * - Angles: degrees at API boundaries
 * - Analysis output must carry algorithmVersion
 */
```

### Quy tắc đơn vị

Chọn **một đơn vị nội bộ chuẩn**.

Khuyến nghị cho phần mềm địa không gian:

```text
distance → meter
height/elevation → meter
angle → degree at UI / explicit conversion internally
time → ISO 8601 UTC
```

Nếu một module sử dụng đơn vị khác, phải ghi rõ.

### Không sử dụng magic numbers

Không viết:

```ts
const value = x * 1000;
```

mà không nói 1000 là gì.

Nên:

```ts
const KILOMETERS_TO_METERS = 1000;
```

và ghi chú lý do.

---

# 28. CONFIGURATION PROFILE

Các thông số quan trọng không nên phân tán trong code.

Tạo một configuration profile:

```text
ProjectConfig
├── coordinateConfig
├── terrainConfig
├── visualizationConfig
├── analysisConfig
├── performanceConfig
└── debugConfig
```

### Debug overlay

Trong development nên có toggle:

```text
DEBUG MODE

Terrain dataset: v4
Analysis algorithm: 2.1
Scenario: 12
Plan: 7
Selected entity: RADAR-01
Coordinate: ...
Height: ...
Entity count: ...
Primitive count: ...
FPS: ...
Analysis state: VALID
```

Mục tiêu là khi người dùng báo lỗi bằng ảnh chụp màn hình, developer có đủ context để bắt đầu debug.

---

# 29. TEST STRATEGY

Dự án này không được chỉ test bằng mắt trên browser.

Cần có ít nhất 5 tầng test.

## 29.1. Unit tests

Test:

- geometry;
- coordinate conversion;
- state transition;
- validation;
- comparison;
- serialization;
- analysis input contracts.

## 29.2. Integration tests

Ví dụ:

```text
Scenario
→ create plan
→ execute analysis
→ save result
→ reopen scenario
→ verify reproducibility metadata
```

## 29.3. Visualization tests

Kiểm tra:

- layer bật/tắt;
- selection 2D/3D;
- cross-section sync;
- camera behavior;
- stale result indicator.

## 29.4. Data validation tests

Thử:

- missing terrain;
- invalid coordinates;
- null geometry;
- old analysis result;
- mismatched version;
- incomplete scenario.

## 29.5. Scenario regression tests

Lưu một số scenario chuẩn làm baseline.

Mỗi lần thay algorithm:

```text
old result
vs
new result
```

Phải có report về khác biệt.

---

# 30. GOLDEN SCENARIOS

Tạo bộ scenario bất biến để kiểm tra toàn hệ thống.

### Scenario 01 — Flat Terrain

Mục tiêu:

- kiểm tra baseline geometry;
- kiểm tra camera;
- kiểm tra performance.

### Scenario 02 — Mountain Blockage

Mục tiêu:

- kiểm tra interaction giữa terrain và analysis visualization;
- kiểm tra cross-section;
- kiểm tra trạng thái cảnh báo khi dữ liệu terrain không đầy đủ.

### Scenario 03 — Multiple Assets

Mục tiêu:

- selection;
- layering;
- symbol hierarchy;
- performance.

### Scenario 04 — Plan vs Observed

Mục tiêu:

- versioning;
- diff;
- audit.

### Scenario 05 — Stale Analysis

Mục tiêu:

- thay đổi plan;
- không tự động coi result cũ là mới;
- hiển thị stale state.

### Scenario 06 — Offline Package

Mục tiêu:

- export;
- import;
- reproduce.

---

# 31. PERFORMANCE ARCHITECTURE

3D terrain và nhiều object có thể khiến browser quá tải.

Không đợi đến cuối dự án mới tối ưu.

Theo dõi:

```text
FPS
CPU time
GPU time
memory
entity count
primitive count
terrain tile count
analysis time
```

### Nguyên tắc

```text
Data LOD
Geometry LOD
Visualization LOD
Analysis resolution
```

phải được kiểm soát độc lập.

Một object có thể có:

```text
2D representation
3D low-detail representation
3D high-detail representation
```

---

# 32. UI/UX WORKFLOW ĐÍCH ĐẾN

Một workflow hoàn chỉnh nên là:

```text
OPEN SCENARIO
     ↓
UNDERSTAND AREA
     ↓
SELECT / CREATE OBJECTS
     ↓
BUILD PLAN
     ↓
VALIDATE INPUTS
     ↓
RUN ANALYSIS
     ↓
REVIEW WARNINGS
     ↓
COMPARE ALTERNATIVES
     ↓
SAVE PLAN VERSION
     ↓
REVIEW / APPROVE FOR SIMULATION
     ↓
RUN SIMULATION / TRAINING
     ↓
CAPTURE OBSERVED STATE
     ↓
AFTER-ACTION REVIEW
```

Không nên bắt người dùng chuyển qua hàng chục màn hình không liên quan.

---

# 33. “ONE SCENARIO, MANY VIEWS”

Đây phải là triết lý UI trung tâm.

Một scenario:

```text
             Scenario
                 │
     ┌───────────┼───────────┐
     ↓           ↓           ↓
    MAP         3D        INSPECTOR
     │           │           │
     └───────────┼───────────┘
                 ↓
             ANALYSIS
                 ↓
             COMPARE
```

Không được để người dùng có cảm giác đang dùng 5 ứng dụng khác nhau.

---

# 34. DATA FLOW MẪU

Ví dụ từ một thao tác chọn đối tượng:

```text
User clicks object
        ↓
Selection Service
        ↓
selectedEntityId
        ↓
 ┌──────┼────────┐
 ↓      ↓        ↓
2D     3D     Inspector
        │
        ↓
Analysis context
        │
        ↓
Cross-section / detail view
```

Ví dụ từ thay đổi terrain:

```text
Terrain changed
      ↓
Input fingerprint changes
      ↓
Existing analysis marked STALE
      ↓
UI shows warning
      ↓
User explicitly reruns analysis
      ↓
New result version saved
```

Đây là behavior rất quan trọng.

---

# 35. STALE DATA MODEL

Mọi result phải có fingerprint của input.

Khái niệm:

```text
InputHash(plan + terrain + config)
```

Khi input thay đổi:

```text
storedResult.inputHash != currentInputHash
```

thì:

```text
result.status = STALE
```

Không âm thầm dùng lại.

---

# 36. SECURITY / INTEGRITY Ở MỨC PHẦN MỀM

Ngay cả bản local cũng nên chuẩn bị kiến trúc cho integrity.

Cần phân biệt:

```text
User
Role
Permission
Scenario ownership
Review authority
```

Những thao tác nhạy cảm trong workflow mô phỏng nên có explicit confirmation và audit.

Ví dụ:

```text
Delete scenario
Archive plan
Change dataset
Approve simulation baseline
```

Không xóa im lặng.

---

# 37. AI — CHỈ ĐƯỢC THÊM SAU KHI DOMAIN VỮNG

Không nên bắt đầu bằng AI.

Trình tự đúng:

```text
Data quality
    ↓
Domain model
    ↓
Deterministic analysis
    ↓
Scenario engine
    ↓
Audit / replay
    ↓
Human evaluation
    ↓
AI assistance
```

AI có thể hỗ trợ về sau ở các nhiệm vụ an toàn như:

- giải thích dữ liệu;
- tìm thiếu dữ liệu;
- tóm tắt scenario;
- phát hiện cấu hình bất thường;
- hỗ trợ truy vấn tự nhiên;
- gợi ý test case;
- tự động sinh báo cáo mô phỏng;
- hỗ trợ debug.

AI không nên trở thành “hộp đen quyết định chiến thuật”.

---

# 38. TẠI SAO MÔ HÌNH NÀY PHÙ HỢP VỚI THỰC TẾ HIỆN ĐẠI?

Các tài liệu công khai về NATO IAMD nhấn mạnh rằng phòng không tích hợp là một năng lực liên tục, có các nhóm chức năng liên kết như giám sát, battle management/C2, active defence và passive defence; chính sách cũng nhấn mạnh sự thích nghi liên tục, khả năng cơ động/tái cấu hình và resilience. citehttps://www.nato.int/en/about-us/official-texts-and-resources/official-texts/2025/02/13/nato-integrated-air-and-missile-defence-policy

Một ví dụ công khai từ U.S. Army cho thấy AMDWS được sử dụng như công cụ lập kế hoạch và nhận thức tình huống, hỗ trợ Common Operational Picture; hệ thống được chứng nhận qua các pha Coordination, Planning, Execution và Reporting. citehttps://www.agc.army.mil/Media/Article-Display/Article/2402227/air-and-missile-defense-workstation-is-the-first-army-system-to-receive-geospatial-certification/

Do đó, hướng phát triển của project nên nhấn mạnh:

```text
planning
+ situational awareness
+ data integration
+ analysis
+ adaptation
+ review
```

thay vì chỉ nhấn mạnh:

```text
place object
+ draw circle
```

---

# 39. LỘ TRÌNH PHÁT TRIỂN DÀI HẠN

## PHASE 0 — BASELINE / FREEZE

### Mục tiêu

Ổn định và hiểu project hiện tại trước khi migration.

### Deliverables

- current architecture map;
- current domain inventory;
- current radar/terrain analysis inventory;
- technical debt register;
- first golden scenario;
- baseline build/test report.

### Exit criteria

```text
Current architecture documented
Baseline scenario reproducible
Known risks documented
```

---

## PHASE 1 — DOMAIN FOUNDATION

### Deliverables

```text
Equipment
Site
Scenario
Plan
Observation
AnalysisResult
Event
SimulationRun
DecisionRecord
```

Không cần triển khai hết UI ngay. Domain contract phải đi trước.

---

## PHASE 2 — PLAN / OBSERVED / SIMULATED SEPARATION

### Mục tiêu

Tách rõ ba nguồn trạng thái:

```text
PLANNED
OBSERVED
SIMULATED
```

Không được dùng một state duy nhất để biểu diễn cả ba.

---

## PHASE 3 — TERRAIN FOUNDATION

Terrain trở thành versioned dataset có quality metadata, coordinate metadata và diagnostics.

---

## PHASE 4 — ANALYSIS FRAMEWORK

Tách analysis khỏi renderer, chuẩn hóa input/output/provenance/validation.

---

## PHASE 5 — 2D / 3D UNIFICATION

2D, 3D, cross-section và Inspector dùng cùng domain state/result.

---

## PHASE 6 — SCENARIO FOUNDATION

### Mục tiêu

Biến project từ “map + analysis” thành một **scenario workspace**.

### Deliverables

- scenario lifecycle;
- cloning/branching;
- baseline snapshot;
- alternative plan;
- assumption list;
- versioned input bundle.

---

## PHASE 7 — SIMULATION ENGINE

### Mục tiêu

Cho phép chạy các training/simulation scenarios có timeline và state transitions.

### Deliverables

- simulation clock;
- deterministic execution khi phù hợp;
- event stream;
- simulation run metadata;
- result snapshot;
- diagnostics;
- replay foundation.

### Exit criteria

Có một scenario mẫu có thể chạy lại và tạo result có cùng provenance.

---

## PHASE 8 — CAMPAIGN / WHAT-IF / COMPARE

### Mục tiêu

Cho phép người dùng thử nhiều alternative từ cùng baseline.

### Deliverables

```text
Campaign
├── Baseline
├── Alternative A
├── Alternative B
├── Alternative C
└── Compare
```

Có kiểm tra “fair comparison” và hiển thị khi điều kiện giữa các run không tương đương.

---

## PHASE 9 — REVIEW / DECISION RECORD

### Mục tiêu

Đưa hoạt động “họp bàn” vào hệ thống ở dạng có cấu trúc.

### Deliverables

- review workspace;
- notes;
- evidence references;
- unresolved questions;
- decision record;
- approval/status lifecycle cho mục đích mô phỏng/huấn luyện.

---

## PHASE 10 — REPLAY / AFTER-ACTION REVIEW

### Mục tiêu

Tái hiện scenario và xem lại quá trình.

### Deliverables

- timeline;
- event playback;
- result overlays;
- review notes;
- compare before/after;
- report export.

---

## PHASE 11 — OFFLINE-FIRST / DISTRIBUTION

Scenario có thể đóng gói với dataset/version manifest, integrity checks và reproduce metadata trong môi trường được chuẩn bị sẵn.

---

## PHASE 12 — ADVANCED ASSISTANCE

Chỉ bắt đầu khi:

```text
Data stable
Domain stable
Analysis stable
Simulation stable
Audit stable
Replay stable
Regression stable
```

Sau đó mới cân nhắc:

- AI assistant;
- natural-language scenario query;
- report drafting;
- data-quality assistant;
- anomaly surfacing;
- scenario summarization.

Tất cả vẫn phải giữ human-in-the-loop và phạm vi mô phỏng/huấn luyện.

---

# 40. DEFINITION OF DONE CHO MỖI FEATURE

Một feature không được coi là hoàn thành chỉ vì “đã hiện trên màn hình”.

### Feature Done Checklist

```text
[ ] Domain model defined
[ ] Input/output contract defined
[ ] State transitions defined
[ ] Validation added
[ ] Error states handled
[ ] 2D behavior handled
[ ] 3D behavior handled if relevant
[ ] Inspector behavior handled if relevant
[ ] Audit event defined
[ ] Versioning considered
[ ] Unit test added
[ ] Regression scenario added
[ ] Debug parameters documented
[ ] Performance measured
[ ] User documentation updated
```

---

# 41. DEFINITION OF DONE CHO ANALYSIS

```text
[ ] Mathematical/logic definition written
[ ] Units documented
[ ] Input assumptions documented
[ ] Edge cases documented
[ ] Missing-data behavior defined
[ ] Output schema defined
[ ] Algorithm versioned
[ ] Regression test exists
[ ] Result stores input fingerprint
[ ] Stale-result logic exists
[ ] Visualization maps 1:1 to result
[ ] Explanation/warnings available
```

---

# 42. ĐỊNH HƯỚNG REPOSITORY / ANTIGRAVITY WORKFLOW

Mỗi workflow lớn nên có format:

```text
1. Read project context
2. Identify affected domain modules
3. Read relevant technical notes
4. Plan changes
5. Implement smallest coherent change
6. Run tests
7. Run build
8. Run regression scenario
9. Verify 2D/3D synchronization
10. Document important parameters
11. Summarize changed files
12. Record known limitations
```

### Không cho phép workflow tự tiện

- đổi domain schema mà không cập nhật migration;
- đổi đơn vị mà không rà soát toàn project;
- thêm magic number;
- viết logic nghiệp vụ trong renderer;
- thay đổi analysis mà không chạy regression;
- phá compatibility của scenario cũ mà không có migration note.

---

# 43. CHANGE MANAGEMENT

Mỗi thay đổi lớn phải trả lời 6 câu hỏi:

```text
WHAT changed?
WHY?
WHICH domain objects changed?
WHICH analysis changed?
WHICH scenarios may be affected?
HOW was it tested?
```

### Commit discipline

Ví dụ:

```text
feat(domain): add scenario lifecycle
feat(analysis): introduce versioned result contract
feat(3d): synchronize cross-section selection
fix(terrain): handle missing elevation tiles
refactor(inspector): split overview and technical tabs
```

Không gom một commit chứa:

```text
UI + terrain + domain + analysis + bug fix
```

trừ khi thật sự không thể tách.

---

# 44. DOCUMENTATION TREE ĐÍCH ĐẾN

Trong repo nên có:

```text
/docs
├── 00_NORTH_STAR.md
├── 01_ARCHITECTURE.md
├── 02_DOMAIN_MODEL.md
├── 03_SCENARIO_MODEL.md
├── 04_TERRAIN_MODEL.md
├── 05_ANALYSIS_FRAMEWORK.md
├── 06_2D_3D_VISUALIZATION.md
├── 07_INSPECTOR.md
├── 08_VERSIONING_AND_AUDIT.md
├── 09_OFFLINE_DATA.md
├── 10_TEST_STRATEGY.md
├── 11_DEBUG_PARAMETERS.md
├── 12_ANTIGRAVITY_WORKFLOW.md
└── /features
```

Tài liệu hiện tại chính là nền tảng để phát triển dần thành bộ này.

---

# 45. ƯU TIÊN CỦA CÁC HẠNG MỤC HIỆN TẠI

Thứ tự ưu tiên mới phải phản ánh North Star 2.0:

### Ưu tiên A — Hiểu project hiện tại

```text
Audit
Current architecture
Current state model
Current analysis inventory
```

### Ưu tiên B — Nền tảng dữ liệu

```text
Scenario
Plan
Observed
SimulationRun
AnalysisResult
Versioning
Audit
```

### Ưu tiên C — Scenario/Simulation

```text
Scenario editor
Alternative branching
Simulation clock
Event/state model
Run history
Replay foundation
```

### Ưu tiên D — Assessment

```text
Result summary
Comparison
Data quality
Assumptions
Limitations
Decision record
```

### Ưu tiên E — 2D/3D/Inspector

```text
Shared state
Terrain analysis
Cross-section
Timeline overlays
Review context
```

### Ưu tiên F — Advanced intelligence

```text
AI assistant
Natural-language query
Report drafting
```

Không ưu tiên F trước khi A–E đủ ổn định.

---

# 46. NHỮNG THỨ TUYỆT ĐỐI KHÔNG ĐƯỢC ĐỂ XẢY RA

## 46.1. UI quyết định domain

Sai:

```text
Button click
→ trực tiếp sửa 5 object trong Cesium
```

Đúng:

```text
User action
→ command
→ domain state
→ renderer update
```

## 46.2. Renderer tự tạo dữ liệu nghiệp vụ

Sai:

```text
Cesium callback
→ tự tính result
```

Đúng:

```text
Analysis service
→ result
→ renderer
```

## 46.3. Result không biết mình sinh từ đâu

Không chấp nhận.

## 46.4. Plan bị ghi đè

Không chấp nhận đối với plan đã review/approved.

## 46.5. Terrain không có version

Không chấp nhận cho analysis nghiêm túc.

## 46.6. Dữ liệu không đủ nhưng UI vẫn nói “OK”

Không chấp nhận.

---

# 47. PRODUCT MATURITY MODEL

Dùng 5 mức trưởng thành để tự đánh giá project.

## Level 1 — Map

```text
Markers
Basic map
Basic inspector
```

## Level 2 — 3D Visualization

```text
Terrain
3D assets
Visualization volumes
Cross-section
```

## Level 3 — Simulation Workspace

```text
Scenario
Plan
Analysis
Versioning
```

## Level 4 — Decision Support Workspace

```text
Compare
Warnings
Uncertainty
Observed vs Plan
Replay
Audit
```

## Level 5 — Mature Simulation Platform

```text
Offline packages
Reproducibility
Automated regression
Multi-user governance
Advanced assistance
```

**Đích đến của project là Level 5 về kiến trúc phần mềm mô phỏng, nhưng không biến thành hệ thống điều khiển hay tự động hóa sử dụng vũ khí.**

---

# 48. KPI CHO DỰ ÁN

Không chỉ đo số lượng feature.

## Product KPIs

```text
Scenario reproducibility
Plan/Observed consistency
Analysis validity rate
Data completeness visibility
Time to understand scenario
Time to diagnose error
```

## Engineering KPIs

```text
Build stability
Regression pass rate
Analysis test coverage
Rendering performance
Memory usage
Scenario migration success rate
```

## UX KPIs

```text
Time to find selected object
Time to understand state
Number of confusing alerts
Number of unsynchronized 2D/3D states
```

---

# 49. CHECKLIST TRƯỚC MỖI BƯỚC PHÁT TRIỂN LỚN

Trước khi bắt đầu một feature:

```text
1. Feature này thuộc domain nào?
2. Nó tạo hoặc thay đổi state nào?
3. Nó có version không?
4. Nó có cần audit không?
5. Nó có tạo analysis result không?
6. Result phụ thuộc input nào?
7. 2D cần phản ánh gì?
8. 3D cần phản ánh gì?
9. Inspector cần phản ánh gì?
10. Dữ liệu thiếu thì sao?
11. Reopen scenario có tái hiện được không?
12. Regression scenario nào bị ảnh hưởng?
```

Nếu chưa trả lời được, chưa nên code feature lớn.

---

# 50. ĐÍCH ĐẾN CUỐI CÙNG — HÌNH DUNG PHIÊN BẢN HOÀN THIỆN

Người dùng mở phần mềm và có thể đi qua một phiên làm việc hoàn chỉnh:

```text
1. OPEN BASELINE
      ↓
2. UNDERSTAND AREA / DATA
      ↓
3. BUILD SCENARIO
      ↓
4. CREATE ALTERNATIVES
      ↓
5. VALIDATE INPUTS
      ↓
6. RUN SIMULATIONS
      ↓
7. REVIEW RESULTS
      ↓
8. COMPARE ALTERNATIVES
      ↓
9. DISCUSS / REVIEW
      ↓
10. RECORD DECISION
      ↓
11. REPLAY / AFTER-ACTION REVIEW
      ↓
12. CREATE NEXT ITERATION
```

### Workspace đích đến

```text
┌─────────────────────────────────────────────────────────────┐
│ CAMPAIGN / SCENARIO / RUN STATUS                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                         2D MAP                              │
│                                                             │
│ objects / terrain / states / changes / warnings             │
│                                                             │
├───────────────────────────────────────┬─────────────────────┤
│                                       │ INSPECTOR / REVIEW  │
│              3D TERRAIN                │                     │
│                                       │ Scenario            │
│ terrain + objects + analysis          │ Plan / Observed     │
│ timeline / simulation context         │ Analysis            │
│                                       │ Data Quality        │
│                                       │ Review Notes        │
├───────────────────────────────────────┴─────────────────────┤
│ TIMELINE │ RESULTS │ COMPARE │ WARNINGS │ DECISION RECORD  │
└─────────────────────────────────────────────────────────────┘
```

### Người dùng phải hiểu được

```text
WHAT EXISTS
WHAT IS PLANNED
WHAT IS OBSERVED
WHAT IS SIMULATED
WHAT IS ASSUMED
WHAT WAS MEASURED / COMPUTED
WHAT CHANGED
WHAT IS UNCERTAIN
WHAT WAS REVIEWED
WHY A DECISION WAS RECORDED
```

Đây là đích đến về **phần mềm mô phỏng và hỗ trợ review**, không phải một hệ thống tự động ra lệnh tác chiến.

---

# 51. NGUYÊN TẮC “KHÔNG ĐI LỆCH HƯỚNG”

Mọi feature mới phải trả lời được ít nhất một câu hỏi thuộc vòng lặp:

```text
MODEL
SCENARIO
SIMULATE
ASSESS
COMPARE
REVIEW
REPLAY
```

Trước khi nhận một feature, hỏi:

```text
1. Nó cải thiện phần nào của decision loop?
2. Nó thuộc domain nào?
3. Nó tạo/chỉnh state nào?
4. Nó có version/provenance không?
5. Nó ảnh hưởng scenario nào?
6. Nó ảnh hưởng simulation nào?
7. Kết quả có thể replay không?
8. Người review có hiểu assumptions/limitations không?
9. 2D/3D/Inspector có còn cùng model không?
10. Có test regression tương ứng không?
```

Không xây feature chỉ vì:

```text
“nhìn đẹp”
“animation hay”
“AI trả lời được”
“demo thấy ấn tượng”
```

nếu nó không đóng góp cho workflow mô phỏng/đánh giá.

---

# 52. ROADMAP THỰC THI THEO THỨ TỰ

```text
CURRENT PROJECT
      ↓
/project-audit
      ↓
CURRENT ARCHITECTURE BASELINE
      ↓
DOMAIN / STATE MIGRATION
      ↓
PLAN / OBSERVED / SIMULATED
      ↓
SCENARIO FOUNDATION
      ↓
SIMULATION RUN MODEL
      ↓
MULTI-SCENARIO CAMPAIGN
      ↓
COMPARE + ASSESSMENT
      ↓
HUMAN REVIEW + DECISION RECORD
      ↓
REPLAY / AFTER-ACTION REVIEW
      ↓
OFFLINE / DISTRIBUTION
      ↓
ADVANCED ASSISTANCE
```

### Rule triển khai

Không nhảy qua `Scenario → Simulation → Assessment` để làm AI hay “smart recommendation”.

Không refactor cả repository trong một lần. Migration phải incremental.

Mỗi phase phải có:

```text
Design note
Implementation
Tests
Regression
Known limitations
Migration note
```

### Đặc biệt với project hiện tại

Radar hiện có thể là **reference implementation** cho toàn bộ kiến trúc, nhưng radar không được độc quyền hóa simulation engine. Mục tiêu là xây framework chung mà các loại sensor/equipment mô phỏng khác có thể dùng lại.

---

# 53. TIÊU CHUẨN NGHIỆM THU CUỐI CÙNG

Có thể coi project đạt North Star khi thỏa các nhóm sau:

### A. Data

- Domain model rõ ràng.
- Plan / Observed / Simulated tách biệt.
- Snapshot/version/provenance đầy đủ.

### B. Scenario

- Có baseline.
- Có alternative.
- Scenario có lifecycle.
- Scenario có thể export/import trong phạm vi được hỗ trợ.

### C. Simulation

- Có SimulationRun riêng.
- Có simulation metadata.
- Có trạng thái `COMPLETE / PARTIAL / INVALID / ERROR`.
- Có replay ở mức state/event.
- Có thể kiểm tra tính tái hiện trong cùng environment.

### D. Assessment

- Result có assumptions.
- Result có data quality.
- Result có limitations.
- Có compare giữa alternatives.

### E. Human Review

- Có review workspace.
- Có notes.
- Có unresolved questions.
- Có decision record.
- Không có “magic winner” tự động được xem như quyết định.

### F. Visualization

- 2D/3D/Inspector đồng bộ.
- Timeline có thể liên kết với state/result.
- Không vẽ result stale như hiện tại.

### G. Engineering

- Automated tests.
- Golden scenarios.
- Regression suite.
- Performance monitoring.
- Debug parameters.
- Documentation.

---

# 54. KẾT LUẬN — KIM CHỈ NAM

Toàn bộ dự án phải được phát triển theo một câu duy nhất:

> **“Không xây một bản đồ để chứa khí tài; xây một môi trường mô phỏng giúp con người hiểu trạng thái, kiểm tra giả định, đánh giá phương án và học lại từ những gì đã xảy ra.”**

Vì vậy, thứ tự tư duy của project phải luôn là:

```text
DATA
 ↓
MODEL
 ↓
SCENARIO
 ↓
PLAN
 ↓
ANALYSIS
 ↓
COMPARE
 ↓
REVIEW
 ↓
SIMULATION
 ↓
OBSERVATION
 ↓
REPLAY
 ↓
LEARNING
```

Còn:

```text
2D
3D
Inspector
Radar visualization
Terrain visualization
Charts
```

chỉ là **các cửa sổ để con người nhìn vào cùng một hệ thống dữ liệu và mô phỏng**.

Nếu giữ nguyên nguyên tắc này, các tính năng được thêm về sau — từ radar, trạm quan sát, sở chỉ huy, các loại cảm biến khác, terrain masking, cross-section, scenario comparison cho tới AI assistant — sẽ cùng nằm trong một kiến trúc thống nhất thay vì trở thành các module rời rạc.

---

# 55. NGUYÊN TẮC AN TOÀN VÀ PHẠM VI SỬ DỤNG

Tài liệu này định hướng một **môi trường mô phỏng, huấn luyện, nhận thức tình huống, quản lý dữ liệu và phân tích ở mức phần mềm**.

Không coi tài liệu này là đặc tả để:

- điều khiển hỏa lực;
- tự động nhận dạng và chọn mục tiêu để tấn công;
- tự động đề xuất hoặc tối ưu vị trí triển khai vũ khí cho một tình huống chiến đấu thực tế;
- tự động ra quyết định khai hỏa;
- điều khiển phương tiện hoặc vũ khí;
- thay thế chỉ huy hoặc quy trình phê duyệt của con người.

Các ví dụ về chiến tranh và hệ thống phòng không được dùng để giải thích **kiến trúc quy trình và bài học về dữ liệu/C2 ở mức công khai**, không phải để làm hướng dẫn vận hành chiến đấu.

---

# 56. TÀI LIỆU THAM KHẢO CÔNG KHAI

1. NATO, **NATO Integrated Air and Missile Defence Policy**, 13 February 2025. Đây là nguồn để tham khảo ở mức kiến trúc/capability về IAMD, situational awareness, adaptability, training/exercises và planning. Không dùng tài liệu này như hướng dẫn vận hành chiến đấu.  
   https://www.nato.int/en/about-us/official-texts-and-resources/official-texts/2025/02/13/nato-integrated-air-and-missile-defence-policy

2. NATO NCIA, **AirC2IS Increment 2 – Planner**, cập nhật 9 February 2026. Trang procurement công khai mô tả một tool suite gồm Planner và một ứng dụng **Defence Design Analysis (D2A) simulation-based** cho IAMD planning.  
   https://www.ncia.nato.int/business/procurement/current-opportunities/115768-2

3. NATO NCIA, **AirC2IS Increment 2 – Defence Design Analysis (D2A) Simulation Tool**, cập nhật 9 February 2026. Dùng làm tham khảo cho tư duy “planning + simulation-based analysis” ở mức capability.  
   https://www.ncia.nato.int/business/procurement/current-opportunities/42602799

4. Google Antigravity, **Agent Skills**. Antigravity hiện dùng `.agents/skills/<skill-folder>/SKILL.md` cho workspace-specific skills và vẫn hỗ trợ workflow cũ trong giai đoạn chuyển tiếp.  
   https://antigravity.google/docs/skills

5. Google Antigravity, **Migrating Workflows to Skills**. Tài liệu hiện hành ghi Workflows sẽ retired ngày **1 November 2026**; skill packages là hướng được khuyến nghị.  
   https://antigravity.google/docs/migration/workflows-to-skills/

---

# 57. CHANGE LOG CỦA TÀI LIỆU

## v2.0 — Scenario-Centric North Star

- Nâng **Scenario/Simulation** từ module phụ thành trục trung tâm của sản phẩm.
- Bổ sung **Scenario Campaign** để tạo và so sánh nhiều alternatives từ cùng baseline.
- Bổ sung **SimulationRun** và simulation provenance.
- Bổ sung pipeline **Simulation → Assessment → Human Review → Decision Record**.
- Bổ sung khái niệm **What-if / Alternative Analysis** và fair-comparison checks.
- Bổ sung review workspace và decision provenance.
- Mở rộng replay thành after-action / learning workflow.
- Cập nhật roadmap thành: domain → state separation → scenario → simulation → campaign → assessment → review → replay.
- Cập nhật acceptance criteria cho scenario/simulation/assessment/review.
- Cập nhật tài liệu Antigravity: ưu tiên **Agent Skills**, giữ workflow legacy để tương thích trong giai đoạn chuyển tiếp.
- Thu hẹp phạm vi vận hành: mô phỏng/huấn luyện/đánh giá có human-in-the-loop; không đặc tả điều khiển hay tối ưu hóa sử dụng vũ khí thực tế.

## v1.0

- Đặt North Star của project.
- Xác định project là simulation / planning environment thay vì map marker tool.
- Tách Plan và Observed State.
- Xác định Scenario là đơn vị mô phỏng.
- Định nghĩa versioning, audit và replay.
- Định nghĩa kiến trúc Domain / Application / Analysis / Visualization.
- Chuẩn hóa nguyên tắc 2D/3D dùng cùng domain state.
- Định hướng terrain thành versioned dataset.
- Định hướng analysis thành versioned result có provenance.
- Đưa debug parameters thành yêu cầu bắt buộc.

---

## PHỤ LỤC A — “RULE OF THUMB” CHO DEVELOPER

Mỗi khi chuẩn bị viết code, hãy tự hỏi:

```text
Tôi đang thay đổi DATA hay chỉ đang vẽ?
Đây là PLAN hay OBSERVED?
Kết quả này có VERSION không?
Tôi có đang đưa business logic vào renderer không?
Tôi có đang dùng MAGIC NUMBER không?
Tôi đã ghi UNIT chưa?
Nếu dữ liệu thiếu thì UI nói gì?
Nếu mở lại scenario sau 1 tuần thì có tái hiện được không?
Nếu đổi terrain thì result cũ có bị đánh dấu stale không?
Nếu chọn object ở 2D thì 3D và Inspector có cùng object không?
```


---

## PHỤ LỤC A.1 — MẪU LUỒNG “THỬ NHIỀU KỊCH BẢN → REVIEW → CHỌN PHƯƠNG ÁN MÔ PHỎNG”

```text
BASELINE
  │
  ├── Alternative A
  │       ↓
  │   Simulation Run A
  │       ↓
  │   Assessment A
  │
  ├── Alternative B
  │       ↓
  │   Simulation Run B
  │       ↓
  │   Assessment B
  │
  └── Alternative C
          ↓
      Simulation Run C
          ↓
      Assessment C

              ↓

        COMPARISON BOARD
              ↓
       HUMAN DISCUSSION
              ↓
        DECISION RECORD
              ↓
      SELECTED SIMULATION PLAN
              ↓
        TRAIN / REVIEW / RE-RUN
```

### Invariant

Lựa chọn ở cuối workflow phải là **record của con người** dựa trên bằng chứng trong hệ thống. Hệ thống không được biến một kết quả simulation thành mệnh lệnh tác chiến.

---

## PHỤ LỤC B — MỤC TIÊU 12 THÁNG THEO NĂNG LỰC, KHÔNG THEO “SỐ FEATURE”

### Mục tiêu 1

Có thể mở một scenario và hiểu được trạng thái của nó mà không cần đọc code.

### Mục tiêu 2

Có thể tạo hai phương án và xem sự khác nhau.

### Mục tiêu 3

Có thể chạy một phân tích và biết chính xác nó dùng dữ liệu/configuration nào.

### Mục tiêu 4

Có thể thay đổi dữ liệu, nhận ra result cũ đã stale và tái chạy một cách có kiểm soát.

### Mục tiêu 5

Có thể replay scenario và xem lịch sử thay đổi.

### Mục tiêu 6

Có thể export/import scenario mà không làm mất ngữ cảnh của dữ liệu.

### Mục tiêu 7

Developer có đủ debug context để tái hiện lỗi mà không phải đoán thông số.

### Mục tiêu 8

Thêm một loại sensor/equipment mới mà không cần viết lại toàn bộ UI hoặc Cesium renderer.

---

# TUYÊN BỐ CUỐI

**Đây là tài liệu định hướng kiến trúc và sản phẩm cấp cao nhất của dự án.**

Bất kỳ kế hoạch feature nào được tạo sau tài liệu này phải:

1. chỉ rõ nó thuộc phần nào của North Star;
2. không phá vỡ separation giữa Plan / Observed / Scenario / Analysis;
3. không tạo logic nghiệp vụ trực tiếp trong renderer;
4. có version, validation, audit và regression phù hợp;
5. ghi rõ các tham số quan trọng để debug;
6. bảo đảm 2D, 3D và Inspector dùng cùng một nguồn dữ liệu;
7. ưu tiên khả năng giải thích và tái hiện hơn hiệu ứng hình ảnh;
8. giữ con người trong vòng quyết định;
9. giữ project trong phạm vi mô phỏng, huấn luyện và hỗ trợ nhận thức tình huống an toàn.

**North Star:**

```text
                   ONE MODEL
                      │
             ┌────────┼────────┐
             ↓        ↓        ↓
            2D       3D    INSPECTOR
             \        |        /
              \       |       /
               └── ANALYSIS ─┘
                      │
                   SCENARIO
                      │
                  VERSIONED
                      │
                 REPLAYABLE
                      │
                EXPLAINABLE
                      │
                 HUMAN-LED
```
