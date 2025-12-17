
from PIL import Image


def make_transparent():
    # Load the image
    img_path = r"c:\Users\PC\Downloads\ghostchat (1)\public\logo.png"
    img = Image.open(img_path).convert("RGBA")
    
    datas = img.getdata()
    
    newData = []
    for item in datas:
        # Check if the pixel is black or very dark [0,0,0] to [20,20,20]
        # Adjust threshold as needed
        if item[0] < 20 and item[1] < 20 and item[2] < 20: 
            newData.append((0, 0, 0, 0)) # Make it transparent
        else:
            newData.append(item)
            
    img.putdata(newData)
    img.save(img_path, "PNG")
    print("Logo transparency processed.")

if __name__ == "__main__":
    make_transparent()
