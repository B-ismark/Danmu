import sys
from PIL import Image, ImageDraw
src,dst=sys.argv[1],sys.argv[2]
im=Image.open(src).convert('RGB'); im=im.resize((1800,900))
d=ImageDraw.Draw(im); W,H=im.size
for deg in range(-180,181,10):
    x=(deg+180)/360*W
    d.line([(x,0),(x,H)],fill=(255,0,0) if deg%90==0 else (255,255,0),width=2 if deg%90==0 else 1)
    d.text((x+3,H*0.52),str(deg),fill=(255,0,0))
for el in (-60,-45,-30,-20,-10,0,10,20,30):
    y=(90-el)/180*H; d.line([(0,y),(W,y)],fill=(0,255,255),width=1); d.text((3,y+2),str(el),fill=(0,255,255))
im.save(dst)
