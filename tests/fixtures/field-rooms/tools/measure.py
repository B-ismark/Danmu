# measure.py pano out.jpg yaw... : equirect crops ±6deg around each yaw, 1deg = 12px, elev -75..+60, ticks every deg
import sys
from PIL import Image, ImageDraw, ImageFont
src,dst=sys.argv[1],sys.argv[2]; yaws=[float(y) for y in sys.argv[3:]]
im=Image.open(src).convert('RGB'); PW,PH=im.size; ppd=PW/360
S=12; top,bot=60,-75
cols=[]
for y in yaws:
    x0=int(((y-6)+180)*ppd); x1=int(((y+6)+180)*ppd)
    y0=int((90-top)*ppd); y1=int((90-bot)*ppd)
    def crop(a,b):
        if a<0: a+=PW;b+=PW
        if b<=PW: return im.crop((a,y0,b,y1))
        c=Image.new('RGB',(b-a,y1-y0)); c.paste(im.crop((a,y0,PW,y1)),(0,0)); c.paste(im.crop((0,y0,b-PW,y1)),(PW-a,0)); return c
    c=crop(x0,x1).resize((12*S,(top-bot)*S)); d=ImageDraw.Draw(c)
    for e in range(bot,top+1):
        yy=(top-e)*S; d.line([(0,yy),(12 if e%5 else 40,yy)],fill=(255,0,0),width=1)
        if e%5==0: d.text((42,yy-6),str(e),fill=(255,0,0))
    d.line([(6*S,0),(6*S,c.size[1])],fill=(0,255,0)); d.text((4,4),'yaw %g'%y,fill=(0,255,0))
    cols.append(c)
out=Image.new('RGB',(len(cols)*(12*S+8),cols[0].size[1]),(0,0,0))
for i,c in enumerate(cols): out.paste(c,(i*(12*S+8),0))
out.save(dst,quality=85)
