# Khúc Ca Hy Vọng — Event Game — Handoff Notes

## Bối cảnh dự án
Game web dựa trên tiểu thuyết gốc của người dùng "Khúc Ca Hy Vọng" (Quyển I của trilogy "The Sower's Cycle" / "Vòng Tuần Hoàn Người Gieo Hạt"). Repo tiểu thuyết: `github.com/Mendingur/mendingur.github.io` (25 chương + 2 interlude tại `/anthemofhope/`). Repo game cũ (ChatGPT làm 7 lần không đạt): `github.com/Mendingur/beta-icaoh`.

Yêu cầu gốc: game web đồ hoạ kiểu **sự kiện giới hạn thời gian của Genshin Impact**, câu đố logic thật sự hại não, khám phá/phiêu lưu, bám sát cốt truyện. Sau nhiều vòng chỉnh sửa, yêu cầu chốt lại là:
- **KHÔNG phải quiz có đồng hồ đếm ngược 10 phút.** "10 phút" chỉ là ước lượng thời lượng chơi tự nhiên, không phải cơ chế ép buộc.
- Phải là **một sự kiện thật sự**: bản đồ tổng cho chọn khu vực tự do, nhiều lớp khám phá, có thể **cày cuốc lại** (đạt sao cao hơn, tìm khám phá/rương còn sót, không chỉ "giải xong là hết").

## Trạng thái hiện tại: ĐÃ VIẾT LẠI HOÀN TOÀN theo kiến trúc Event Map

**File output:** `/mnt/user-data/outputs/index.html` + `/mnt/user-data/outputs/game.js` — 2 file, tự chứa, deploy thẳng lên GitHub Pages.

### Kiến trúc
- **State toàn cục** (`STATE`, `getProgress(key)`): mỗi khu vực có `{ stars, discoveries:Set, chestOpened, mainDone }`, lưu trong bộ nhớ phiên (không persist qua reload — chưa có localStorage/server).
- **World map** (`renderMap()` trong game.js, gốc từ `worldmap.js`): SVG con đường nối 5 node, mở khoá tuần tự (khu vực N+1 mở khi khu vực N có `mainDone=true`). Hiện tổng sao/khám phá/rương ở header.
- **Region template dùng chung** (`buildRegionScreen()`, gốc từ `region_template.js`): mỗi khu vực = minh hoạ SVG nền + 3 hotspot khám phá (chạm → hội thoại, đánh dấu đã khám phá) + 1 rương ẩn (hiện sau khi khám phá hết 3 hotspot) + 1 nút vào thử thách chính.
- **5 khu vực** (mỗi khu vực từng là file riêng `region_*.js`, giờ đã ghép hết vào `game.js`):
  1. **Gò Sen** (`gosen`) — câu đố chuỗi số ẩn quy luật (Fibonacci, cấp số cộng bậc 2, dãy xen kẽ). Đã verify đáp án đúng bằng Python.
  2. **Vô Ưu Cổ Tự** (`voutucotu`) — câu đố bát giác suy luận kiểu Zebra Puzzle. **Đã verify bằng brute-force: 40320 hoán vị → nghiệm DUY NHẤT** sau 5 mệnh đề + 1 neo cố định (Ánh Sáng ở đỉnh, vị trí 0). Solution: `[sang,hat,sen,gio,bong,nuoc,da,lua]`.
  3. **Chiến Hào** (`chienhao`) — xếp 4 người vào 4 vị trí theo thứ tự tuyến tính. **Đã verify: 24 hoán vị → nghiệm duy nhất** `Mai(0)-Kaito(1)-Sarah(2)-Alex(3)`.
  4. **Biển Nam** (`biennnam`) — định vị lưới toạ độ 5×5 bằng khoảng cách Manhattan/Chebyshev. **Đã verify: 25 ô → nghiệm duy nhất** = D2 (col=3,row=1).
  5. **Cánh Cổng Nam Cực** (`canhcong`) — hệ 3 phương trình tuyến tính (miền 1-9). **Đã verify: 729 tổ hợp → nghiệm duy nhất** = (1,4,7). Đây là khu vực cuối, hoàn thành nó trigger `checkEventCompletion()` → modal ăn mừng tổng kết toàn event.
- **Mỗi thử thách chính** mở trong 1 `overlay` full-screen riêng (`position:fixed;inset:0;z-index:250`), có nút ✕ đóng giữa chừng (huỷ không mất tiến trình khám phá), nút hành động chính cố định ở đáy overlay (không phải trong vùng cuộn — bài học từ bug UX trước đó).

### Bug nghiêm trọng đã tìm và sửa (QUAN TRỌNG — đừng lặp lại)
`showScreen()` ban đầu chỉ bỏ `.active` class khỏi screen cũ khi chuyển màn, **không xoá `innerHTML`** → các phần tử con có cùng `id` (vd. `#mainChallengeBtn`, `#symbolTrayCT`) từ NHIỀU khu vực tồn tại đồng thời trong DOM → `document.getElementById()` trả về nhầm phần tử của khu vực cũ → khu vực thứ 2 trở đi bị treo hoàn toàn (nút không phản hồi). **Đã sửa**: mỗi lần `showScreen()` được gọi, mọi screen không phải screen đích đều bị `child.innerHTML = ''` để dọn sạch DOM. Đã verify bằng test không còn tích luỹ `<style>` tag hay node thừa.

### Đã test (qua jsdom, KHÔNG phải trình duyệt thật)
- Boot → intro modal → mở map → 5 node hiển thị đúng trạng thái locked/open.
- Hoàn thành tuần tự cả 5 khu vực: khám phá 3 hotspot mỗi khu vực → mở rương → giải đúng puzzle chính → nhận sao → quay lại map → khu vực tiếp theo tự mở khoá.
- Modal ăn mừng cuối cùng "Những Hạt Giống Còn Sót Lại" xuất hiện đúng lúc sau khu vực 5.
- **Replay**: vào lại khu vực đã hoàn thành (Gò Sen), nút thử thách hiện "✓ ... — ★3/3", bấm vào vẫn chơi lại được từ đầu.
- 0 lỗi runtime trong toàn bộ các test trên, viewport giả lập 375×667 (iPhone SE).

## VIỆC CẦN LÀM NGAY (cập nhật sau phiên 2 — xem log dưới)

1. **Test trên trình duyệt thật / thiết bị thật.** VẪN CHƯA LÀM — vẫn là rủi ro lớn nhất. Toàn bộ test (cả phiên 1 và phiên 2) chỉ chạy qua jsdom.

2. ~~Kiểm tra kích thước touch target trên world map~~ **ĐÃ SỬA (phiên 2).** Node map giờ có hitbox riêng `<circle r="40">` trong suốt (`.map-node-hit`), tách biệt khỏi vòng tròn hiển thị `r=30`. Với viewBox `360×640`, ở màn hình hẹp nhất thực tế (320px), scale ≈0.89 → vùng chạm thực ≈71px, vẫn dư an toàn so với chuẩn 44px. Xem `mapNodeSVG()` trong game.js.

3. ~~Kiểm tra overlay mini-game trên viewport thấp~~ **ĐÃ SỬA (phiên 2), chỉ riêng lưới 5×5 Biển Nam.** Phát hiện bug thật: `gridHTML()` tính kích thước ô chỉ dựa vào `window.innerWidth`, không xét chiều cao — ở landscape thấp (vd. 667×375) sẽ vẽ ô 54px dù chiều cao khả dụng rất hẹp, dễ gây tràn. Đã sửa để lấy `min(cellByWidth, cellByHeight)` với `heightBudget = innerHeight - 260` (ước lượng phần tiêu đề/clue/nút đáy). Các overlay khác (bát giác, trụ 4 vị trí, phương trình) dùng SVG `viewBox` nội tại hoặc `max-width` nên tự co giãn theo `width:100%`, không có cùng lỗi — nhưng CHƯA test hình ảnh thật trên landscape, chỉ xác nhận cấu trúc CSS đúng pattern `flex:1;overflow-y:auto`.

4. ~~Nhãn tên khu vực trên map — race condition lúc tải~~ **ĐÃ SỬA (phiên 2).** `positionLabels()` trước đây gọi `getBoundingClientRect()` đồng bộ ngay sau `showScreen()`, có thể đọc rect rỗng nếu SVG chưa kịp layout. Đã thêm: (a) guard bỏ qua nếu `rect.width/height === 0`, (b) đổi từ gọi ngay sang `requestAnimationFrame` lồng đôi (đợi 1 khung hình đã paint). Đã verify bằng test rằng hàm không crash khi rect rỗng (jsdom luôn trả rect rỗng nên đây là test tốt cho đúng tình huống race-condition, nhưng KHÔNG thay thế được việc xem nhãn có đúng vị trí trên trình duyệt thật hay không).

5. **Polish hiệu ứng chuyển cảnh** giữa map ↔ khu vực. CHƯA LÀM — vẫn chỉ opacity fade 0.4s.

6. **Minh hoạ SVG các khu vực còn ở mức cơ bản.** CHƯA LÀM.

7. ~~Chưa có persistence~~ **ĐÃ LÀM (phiên 2).** Thêm module `Persist` (localStorage, key `khucCaHyVong_save_v1`, có version `v:1`). Lưu `regionProgress` (Set→Array khi serialize, Array→Set khi deserialize), `muted`, `eventCelebrated`. `Persist.save()` được gọi ở đầu `buildRegionScreen()` — hàm này chạy lại sau MỌI thay đổi tiến trình (khám phá, mở rương, hoàn thành thử thách), nên đảm bảo không bỏ sót điểm mutate nào kể cả nếu thêm khu vực mới sau này. Cũng lưu ngay khi bấm nút mute. Khi `boot()` phát hiện có save cũ (`Persist.hasSave()`), hiện modal "Chào mừng trở lại" cho chọn Tiếp tục / Bắt đầu lại từ đầu (bắt đầu lại sẽ `Persist.clear()` + reset toàn bộ `STATE.regionProgress`). Có try/catch quanh mọi thao tác localStorage — nếu bị chặn (chế độ ẩn danh nghiêm ngặt, quota đầy) game vẫn chơi được bình thường trong phiên, chỉ không lưu lại được.

8. **`checkEventCompletion()` giả định thứ tự cố định.** CHƯA ĐỔI — vẫn đúng như mô tả cũ, chỉ áp dụng nếu sau này đổi sang bản đồ tự do.

## Việc mới phát sinh cần lưu ý cho phiên sau

- Test #6 (grid landscape) và #7 (label zero-rect) mới chỉ verify LOGIC/CÔNG THỨC qua jsdom, chưa verify HÌNH ẢNH thật. Khi có phản hồi từ thiết bị thật, đây là nơi đầu tiên nên kiểm tra nếu người dùng báo "lưới Biển Nam bị vỡ layout" hoặc "nhãn map bị lệch lúc mới vào".
- File test mới: `/home/claude/build2/test.js` (không phải deliverable, chỉ là harness nội bộ — dùng `jsdom`, polyfill `requestAnimationFrame` bằng `setTimeout(0)`, polyfill `localStorage` bằng in-memory object). Nếu cần chạy lại: `cd /home/claude/build2 && npm install jsdom --silent && node test.js`. Lưu ý quan trọng đã rút ra: khi test dialogue trong jsdom, phải kiểm tra class `show` trên `#dialogueCard` để biết dialogue đã đóng chưa — KHÔNG được chỉ kiểm tra sự tồn tại của nút trong `#dActions`, vì `dActions.innerHTML` chỉ bị xoá khi `say()` được gọi LẦN TIẾP THEO, không tự xoá khi dialogue ẩn đi. Nút cũ vẫn nằm trong DOM sau khi đóng — vô hại cho gameplay thật (bị che bởi `opacity:0;pointer-events:none` của dialogue wrap) nhưng dễ gây vòng lặp vô hạn giả nếu viết test sai.
- `Persist.save()` gọi khá thường xuyên (mỗi lần render lại region screen, kể cả khi không mutate gì) — hiện chấp nhận được vì `localStorage.setItem()` rẻ, nhưng nếu sau này thêm nhiều khu vực hoặc gọi `buildRegionScreen()` trong vòng lặp animation, cân nhắc debounce.



## Ghi chú kỹ thuật khác
- Toàn bộ âm thanh dùng WebAudio tổng hợp thuần (oscillator), không phụ thuộc file âm thanh ngoài — tránh lỗi 404 khi deploy.
- Copyright: mọi nội dung SVG minh hoạ, hội thoại đều viết mới, không sao chép nguyên văn từ tiểu thuyết gốc — chỉ dùng làm nền tảng ý tưởng/motif.
- Môi trường build: `/home/claude/build2/` (chứa `index.html`, `game.js`, `HANDOFF.md`, và `test.js` — file test nội bộ, không phải deliverable). Bản cuối đã copy sang `/mnt/user-data/outputs/`.
