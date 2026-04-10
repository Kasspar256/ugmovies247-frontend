from PIL import Image
import numpy as np

def remove_white_bg():
    # Load original jpeg and convert to RGBA
    img = Image.open("/home/kasspar/.openclaw/workspace/ugmovies247-frontend/public/logo2.jpeg").convert("RGBA")
    data = np.array(img)

    # Deconstruct channels
    r, g, b, a = data.T
    
    # Target all white/off-white pixels (high RGB values)
    white_areas = (r > 240) & (g > 240) & (b > 240)
    
    # Make them completely transparent
    data[..., :-1][white_areas.T] = (0, 0, 0)
    data[..., -1][white_areas.T] = 0

    img2 = Image.fromarray(data)
    img2.save("/home/kasspar/.openclaw/workspace/ugmovies247-frontend/public/logo2_clean_transparent.png")
    
remove_white_bg()
