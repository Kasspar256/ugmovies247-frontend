from PIL import Image
import os

input_path = '/home/kasspar/.openclaw/workspace/ugmovies247-frontend/public/images/ugmovieslogo.jpeg'
output_path = '/home/kasspar/.openclaw/workspace/ugmovies247-frontend/public/images/ugmovieslogo_transparent.png'

print("[*] Processing image to rip out black background...")

try:
    img = Image.open(input_path).convert("RGBA")
    data = img.getdata()

    new_data = []
    # Loop through every single pixel
    for item in data:
        # If the pixel is very dark (black or near-black), we make it completely transparent
        if item[0] < 30 and item[1] < 30 and item[2] < 30:
            new_data.append((item[0], item[1], item[2], 0))  # Full transparency (Alpha = 0)
        else:
            # We keep the red/white pixels intact
            new_data.append(item)

    img.putdata(new_data)
    img.save(output_path, "PNG")
    print(f"[+] Success! Saved fully transparent PNG at: {output_path}")

except Exception as e:
    print(f"[!] Target Failed: {e}")
