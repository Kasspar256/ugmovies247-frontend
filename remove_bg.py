from PIL import Image
import numpy as np

def remove_background():
    img = Image.open("/home/kasspar/.openclaw/workspace/ugmovies247-frontend/public/logo2.jpeg").convert("RGBA")
    data = np.array(img)

    r, g, b, a = data.T
    
    # Identify pixels near dark (since logo likely has dark bg hiding)
    dark_areas = (r < 50) & (g < 50) & (b < 50)
    data[..., :-1][dark_areas.T] = (0, 0, 0)
    data[..., -1][dark_areas.T] = 0

    img2 = Image.fromarray(data)
    img2.save("/home/kasspar/.openclaw/workspace/ugmovies247-frontend/public/logo2_transparent.png")
    
remove_background()
