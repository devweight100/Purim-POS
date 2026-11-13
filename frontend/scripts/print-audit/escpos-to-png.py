"""Decode the ESC/POS raster bytes desktop/escpos-raster.js sends (GS v 0 bands) into a PNG.
Usage: python3 escpos-to-png.py receipt.bin out.png"""
import sys
from PIL import Image

data = open(sys.argv[1], 'rb').read()
rows = []
width = None
i = 0
while i < len(data):
    if data[i:i + 4] == b'\x1d\x76\x30\x00':
        bpr = data[i + 4] | (data[i + 5] << 8)
        n = data[i + 6] | (data[i + 7] << 8)
        width = bpr * 8
        start = i + 8
        for y in range(n):
            rows.append(data[start + y * bpr:start + (y + 1) * bpr])
        i = start + bpr * n
    else:
        i += 1
if not rows:
    sys.exit('no raster image in ' + sys.argv[1])
img = Image.new('1', (width, len(rows)), 1)
px = img.load()
for y, row in enumerate(rows):
    for x in range(width):
        if row[x >> 3] & (0x80 >> (x & 7)):
            px[x, y] = 0
img.save(sys.argv[2])
print('%dx%d cut=%s' % (width, len(rows), b'\x1d\x56\x42' in data))
