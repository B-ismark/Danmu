"""Cut a level, straight-on perspective view out of an equirectangular panorama.
usage: slice.py pano.jpg out.jpg yaw_deg [--hfov deg] [--w 1600 --h 1200] [--guide] [--pitch deg]
yaw 0 = panorama centre column, positive = turn right."""
import sys, math, argparse
import numpy as np
from PIL import Image, ImageDraw
ap=argparse.ArgumentParser()
ap.add_argument('src'); ap.add_argument('dst'); ap.add_argument('yaw',type=float)
ap.add_argument('--hfov',type=float,default=2*math.degrees(math.atan(17.3/27)))
ap.add_argument('--w',type=int,default=1600); ap.add_argument('--h',type=int,default=1200)
ap.add_argument('--pitch',type=float,default=0); ap.add_argument('--guide',action='store_true')
ap.add_argument('--exif-time'); ap.add_argument('--focal35',type=int,default=27)
a=ap.parse_args()
pano=np.asarray(Image.open(a.src).convert('RGB')).astype(np.float32)
PH,PW,_=pano.shape
f=(a.w/2)/math.tan(math.radians(a.hfov)/2)
xs=np.arange(a.w)-(a.w-1)/2; ys=np.arange(a.h)-(a.h-1)/2
X,Y=np.meshgrid(xs,ys)
# camera: x right, y down, z forward
dx,dy,dz=X,Y,np.full_like(X,f)
p=math.radians(a.pitch)  # positive pitch = look up
dy2=dy*math.cos(p)-dz*math.sin(p); dz2=dy*math.sin(p)+dz*math.cos(p)
yaw=np.arctan2(dx,dz2)+math.radians(a.yaw)
el=np.arctan2(-dy2,np.hypot(dx,dz2))
u=((yaw/(2*math.pi)+0.5)%1.0)*PW-0.5
v=(0.5-el/math.pi)*PH-0.5
u0=np.floor(u).astype(int); v0=np.clip(np.floor(v).astype(int),0,PH-2)
fu=(u-u0)[...,None]; fv=(v-v0)[...,None]
u1=(u0+1)%PW; u0=u0%PW
out=(pano[v0,u0]*(1-fu)*(1-fv)+pano[v0,u1]*fu*(1-fv)+pano[v0+1,u0]*(1-fu)*fv+pano[v0+1,u1]*fu*fv)
im=Image.fromarray(np.clip(out,0,255).astype(np.uint8))
if a.guide:
    d=ImageDraw.Draw(im)
    for yy in range(0,a.h,a.h//12): d.line([(0,yy),(a.w,yy)],fill=(0,255,255),width=1)
    for xx in range(0,a.w,a.w//16): d.line([(xx,0),(xx,a.h)],fill=(255,255,0),width=1)
    im.save(a.dst,quality=80); sys.exit()
exif=Image.Exif()
exif[0x010F]='Danmu test set'; exif[0x0110]='Equirectangular slice'
ifd=exif.get_ifd(0x8769)
ifd[0xA405]=a.focal35
if a.exif_time: ifd[0x9003]=a.exif_time
im.save(a.dst,quality=90,exif=exif)
