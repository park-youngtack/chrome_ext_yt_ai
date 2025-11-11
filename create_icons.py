#!/usr/bin/env python3
from PIL import Image, ImageDraw, ImageFont

def create_icon(size, filename):
    # 배경색 - 파란색 계열
    bg_color = (33, 150, 243)  # Blue

    # 이미지 생성
    img = Image.new('RGB', (size, size), bg_color)
    draw = ImageDraw.Draw(img)

    # 흰색 텍스트 "한" 추가
    text = "한"

    # 폰트 크기 계산 (아이콘 크기의 60%)
    font_size = int(size * 0.6)

    try:
        # 시스템 폰트 시도
        font = ImageFont.truetype("/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc", font_size)
    except:
        try:
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", font_size)
        except:
            # 기본 폰트 사용
            font = ImageFont.load_default()

    # 텍스트 중앙 배치
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]

    x = (size - text_width) // 2
    y = (size - text_height) // 2 - bbox[1]

    # 텍스트 그리기
    draw.text((x, y), text, fill='white', font=font)

    # 테두리 추가
    border_width = max(1, size // 32)
    draw.rectangle(
        [(0, 0), (size-1, size-1)],
        outline=(25, 118, 210),
        width=border_width
    )

    # 저장
    img.save(filename)
    print(f"Created {filename}")

# 16x16, 48x48, 128x128 아이콘 생성
create_icon(16, '/home/user/chrome_ext_yt_ai/icons/icon16.png')
create_icon(48, '/home/user/chrome_ext_yt_ai/icons/icon48.png')
create_icon(128, '/home/user/chrome_ext_yt_ai/icons/icon128.png')

print("All icons created successfully!")
