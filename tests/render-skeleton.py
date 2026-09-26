"""Rasterize exported game vertices/UVs/alpha texture; no concept-art substitute."""
import argparse
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont

parser = argparse.ArgumentParser()
parser.add_argument('directory', nargs='?', default='/mnt/data/skeleton-warrior')
parser.add_argument('--still-only', action='store_true')
args = parser.parse_args()
root = Path(args.directory)
data = json.loads((root / 'model.json').read_text())
faces = np.array(data['indices']).reshape(-1, 3)
colors = np.array(data['colors']).reshape(-1, 3)
uv = np.array(data['uv']).reshape(-1, 2)
textured = np.array(data['faceMaterial']) == 1
two_sided = np.array(data['doubleSided'])
tex = np.array(data['texture']['data'], dtype=np.uint8).reshape(data['texture']['height'], data['texture']['width'], 4)
texrgb = tex[:, :, :3] / 255.
texrgb = np.where(texrgb <= .04045, texrgb / 12.92, ((texrgb + .055) / 1.055) ** 2.4)
key_light = np.array([-.5, .75, 1.]); key_light /= np.linalg.norm(key_light)
fill = np.array([.8, .2, -.4]); fill /= np.linalg.norm(fill)
font_path = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
title_font = ImageFont.truetype(font_path, 36)
label_font = ImageFont.truetype(font_path, 23)
small_font = ImageFont.truetype(font_path, 19)

def render(vertices, width, height, az, el, scale, center, floor, target_y=0):
    verts = np.array(vertices).reshape(-1, 3).copy()
    verts[:, 1] -= target_y
    right = np.array([np.cos(az), 0, -np.sin(az)])
    up = np.array([-np.sin(az)*np.sin(el), np.cos(el), -np.cos(az)*np.sin(el)])
    view = np.cross(right, up)
    projected = np.stack([verts @ right * scale + center, floor - verts @ up * scale, verts @ view], axis=1)
    image = np.zeros((height, width, 3), dtype=np.uint8)
    # Quiet studio background, with a small vertical gradient.
    for y in range(height): image[y, :, :] = [25 + int(y/height*5), 30 + int(y/height*6), 37 + int(y/height*8)]
    depth = np.full((height, width), -np.inf)
    triangles = verts[faces]
    normals = np.cross(triangles[:, 1]-triangles[:, 0], triangles[:, 2]-triangles[:, 0])
    lengths = np.linalg.norm(normals, axis=1)
    normals /= np.maximum(lengths[:, None], 1e-12)
    for f, face in enumerate(faces):
        normal = normals[f]
        facing = normal @ view
        if lengths[f] < 1e-12 or (facing < 0 and not two_sided[f]): continue
        if facing < 0: normal = -normal
        p = projected[face]
        x0 = max(0, int(np.floor(p[:, 0].min()))); x1 = min(width-1, int(np.ceil(p[:, 0].max())))
        y0 = max(0, int(np.floor(p[:, 1].min()))); y1 = min(height-1, int(np.ceil(p[:, 1].max())))
        if x1 < x0 or y1 < y0: continue
        a,b,c = p
        denominator = (b[1]-c[1])*(a[0]-c[0]) + (c[0]-b[0])*(a[1]-c[1])
        if abs(denominator) < 1e-10: continue
        X,Y = np.meshgrid(np.arange(x0,x1+1)+.5,np.arange(y0,y1+1)+.5)
        w0 = ((b[1]-c[1])*(X-c[0])+(c[0]-b[0])*(Y-c[1]))/denominator
        w1 = ((c[1]-a[1])*(X-c[0])+(a[0]-c[0])*(Y-c[1]))/denominator
        w2 = 1-w0-w1
        z = w0*a[2]+w1*b[2]+w2*c[2]
        target = depth[y0:y1+1,x0:x1+1]
        mask = (w0>=-1e-6)&(w1>=-1e-6)&(w2>=-1e-6)&(z>target)
        if not mask.any(): continue
        shade = .44 + .67*max(0,normal@key_light) + .17*max(0,normal@fill)
        if textured[f]:
            u = w0*uv[face[0],0]+w1*uv[face[1],0]+w2*uv[face[2],0]
            v = w0*uv[face[0],1]+w1*uv[face[1],1]+w2*uv[face[2],1]
            tx = np.clip(((u % 1)*tex.shape[1]).astype(int),0,tex.shape[1]-1)
            ty = np.clip((v*tex.shape[0]).astype(int),0,tex.shape[0]-1)
            mask &= tex[ty,tx,3] > 115
            rgb = texrgb[ty,tx] * shade
        else:
            rgb = colors[face].mean(axis=0) * shade
        rgb = np.clip(rgb, 0, 1)
        rgb = np.where(rgb <= .0031308, 12.92*rgb, 1.055*rgb**(1/2.4)-.055)
        output = (rgb*255).astype(np.uint8)
        region = image[y0:y1+1,x0:x1+1]
        region[mask] = output[mask] if textured[f] else output
        target[mask] = z[mask]
    return Image.fromarray(image)

def label(draw, text, xy, font=label_font, color=(224,217,200)):
    draw.text(xy, text, font=font, fill=color)

sheet = Image.new('RGB',(1800,1200),(25,30,37))
sheet.paste(render(data['still'],600,980,0,.055,440,300,900),(0,145))
sheet.paste(render(data['still'],650,980,.62,.11,440,340,900),(570,145))
sheet.paste(render(data['still'],590,660,.26,.035,1450,295,600,1.52),(1210,215))
draw = ImageDraw.Draw(sheet)
label(draw,'SKELETON WARRIOR', (48,35),title_font)
label(draw,'Actual game mesh  /  shared human rig  /  low-poly study', (49,89),small_font,(157,172,184))
label(draw,'FRONT', (52,165))
label(draw,'THREE-QUARTER', (645,165))
label(draw,'SKULL DETAIL', (1270,165))
label(draw,'Recessed eye sockets', (1270,930),small_font)
label(draw,'Softer brows / triangular nose', (1245,965),small_font)
label(draw,'Fitted iron nasal helmet', (1270,1000),small_font)
label(draw,f"{data['triangles']:,} body triangles  •  23 bones  •  2 body material passes  •  256 × 256 rib texture", (48,1140),small_font,(167,183,190))
sheet.save(root/'skeleton-warrior-preview.png')
print(root/'skeleton-warrior-preview.png',flush=True)

if not args.still_only:
    frames=[]
    for i,vertices in enumerate(data['walk']):
        im=render(vertices,700,840,.62,.11,355,355,756)
        draw=ImageDraw.Draw(im)
        label(draw,'SKELETON WARRIOR', (28,24),label_font)
        label(draw,'Existing human walk cycle • actual skinned mesh', (28,62),small_font,(164,183,195))
        label(draw,'Textured ribs / same 23-bone rig', (28,800),small_font,(164,183,195))
        frames.append(im)
    frames[0].save(root/'skeleton-warrior-walk.gif',save_all=True,append_images=frames[1:],duration=34,loop=0,optimize=True)
    print(root/'skeleton-warrior-walk.gif',flush=True)

    samples=[('jab','JAB'),('swing','SWING'),('block','BLOCK / HOLD')]
    az,el=-.65,.11
    right=np.array([np.cos(az),0,-np.sin(az)])
    up=np.array([-np.sin(az)*np.sin(el),np.cos(el),-np.cos(az)*np.sin(el)])
    bounds=[]
    for key,_ in samples:
        vertices=np.array(data[key]).reshape(-1,3)
        xs,ys=vertices@right,vertices@up
        bounds.append((xs.min(),xs.max(),ys.min(),ys.max()))
    low_y=min(b[2] for b in bounds)
    high_y=max(b[3] for b in bounds)
    scale=min(520/max(b[1]-b[0] for b in bounds),535/(high_y-low_y))
    framing=[(scale,300-(b[0]+b[1])*.5*scale,680+low_y*scale) for b in bounds]
    frames=[]
    for frame in range(48):
        im=Image.new('RGB',(1800,800),(25,30,37))
        for col,((key,title),(scale,center,floor)) in enumerate(zip(samples,framing)):
            panel=render(data[key][frame],600,800,az,el,scale,center,floor)
            draw=ImageDraw.Draw(panel)
            label(draw,title,(30,110))
            im.paste(panel,(col*600,0))
        draw=ImageDraw.Draw(im)
        label(draw,'SKELETON WARRIOR  /  COMBAT SAMPLES',(30,24),title_font)
        label(draw,'Actual rig + helmet  •  existing humanoid animations  •  three-quarter view',(30,77),small_font,(164,183,195))
        label(draw,'Jab and swing return to guard; block remains held.',(30,752),small_font,(164,183,195))
        frames.append(im)
    frames[0].save(root/'skeleton-warrior-combat.gif',save_all=True,append_images=frames[1:],duration=42,loop=0,optimize=True)
    print(root/'skeleton-warrior-combat.gif',flush=True)
