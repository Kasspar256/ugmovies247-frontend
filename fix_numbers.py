from PIL import Image
import numpy as np

def make_dark_text_white():
    # Keep the perfectly transparent one we just made
    img = Image.open("/home/kasspar/.openclaw/workspace/ugmovies247-frontend/public/logo2_brute.png").convert("RGBA")
    data = np.array(img)

    r, g, b, a = data.T
    
    # Target ONLY the dark text (24_7 and the dark lines on the clapperboard)
    # They have low red, low green, and low blue. The red text has HIGH red.
    dark_pixels = (a > 50) & (r < 150) & (g < 150) & (b < 150)
    
    # Turn strictly those dark pixels into pure white
    data[..., 0][dark_pixels.T] = 255 # R
    data[..., 1][dark_pixels.T] = 255 # G
    data[..., 2][dark_pixels.T] = 255 # B

    img2 = Image.fromarray(data)
    img2.save("/home/kasspar/.openclaw/workspace/ugmovies247-frontend/public/logo2_white_text.png")

make_dark_text_white()
