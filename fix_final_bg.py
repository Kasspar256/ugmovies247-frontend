from PIL import Image
import numpy as np

def brute_force_bg_removal():
    img = Image.open("/home/kasspar/.openclaw/workspace/ugmovies247-frontend/public/logo2.jpeg").convert("RGBA")
    data = np.array(img)
    r, g, b, a = data.T

    # The issue: the text "24_7" is dark, the "UGMOVIES" is red.
    # The background is white/light gray.
    # We strip all pixels that are relatively light (R,G,B > 200).
    light_pixels = (r > 200) & (g > 200) & (b > 200)
    
    # Make them fully transparent
    data[..., -1][light_pixels.T] = 0

    img2 = Image.fromarray(data)
    img2.save("/home/kasspar/.openclaw/workspace/ugmovies247-frontend/public/logo2_brute.png")

brute_force_bg_removal()
