from PIL import Image
import numpy as np

def fix():
    img = Image.open("/home/kasspar/.openclaw/workspace/ugmovies247-frontend/public/logo2_brute.png").convert("RGBA")
    data = np.array(img)
    r, g, b, a = data.T
    
    # Strictly target ONLY the solid black/dark pixels. 
    # Do NOT touch anti-aliased edge blends or artifacts.
    black_pixels = (a > 200) & (r < 80) & (g < 80) & (b < 80)
    
    data[..., 0][black_pixels.T] = 255
    data[..., 1][black_pixels.T] = 255
    data[..., 2][black_pixels.T] = 255

    img2 = Image.fromarray(data)
    img2.save("/home/kasspar/.openclaw/workspace/ugmovies247-frontend/public/logo2_perfect.png")

fix()
