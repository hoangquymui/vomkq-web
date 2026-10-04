---
trigger: always_on
description: "Buộc thay đổi lớn đi qua plan, impact map, tests và regression trước khi coi là hoàn tất."
---
# Change Discipline

Nếu feature chạm từ 2 layer trở lên:
1. impact map;
2. domain/application contract;
3. implementation incremental;
4. tests;
5. regression scenarios;
6. changelog/known limitations.

Không refactor toàn repo chỉ để phục vụ một feature nhỏ.
Không tự git push.
