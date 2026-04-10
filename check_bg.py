from PIL import Image
import numpy as np

img = Image.open("/home/kasspar/.openclaw/workspace/ugmovies247-frontend/public/logo2.jpeg")
data = np.array(img)
print("Top-left pixel:", data[0, 0])
print("Bottom-right pixel:", data[-1, -1])
