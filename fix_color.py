from PIL import Image
import numpy as np

def make_dark_pixels_white():
    # Load the already transparent image
    img = Image.open("/home/kasspar/.openclaw/workspace/ugmovies247-frontend/public/logo2_clean_transparent.png")
    data = np.array(img)

    r, g, b, a = data.T
    
    # Target pixels that are visible (alpha > 0) AND dark (R, G, B are all relatively low)
    # This will catch the black "24_7" text and the black parts of the clapperboard,
    # but ignore the bright RED "UGMOVIES" text (since its R value is high).
    dark_areas = (a > 50) & (r < 130) & (g < 130) & (b < 130)
    
    # Turn those dark pixels completely white
    data[..., 0][dark_areas.T] = 255 # R
    data[..., 1][dark_areas.T] = 255 # G
    data[..., 2][dark_areas.T] = 255 # B

    img2 = Image.fromarray(data)
    img2.save("/home/kasspar/.openclaw/workspace/ugmovies247-frontend/public/logo2_final.png")

make_dark_pixels_white()
