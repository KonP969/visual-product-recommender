from fastapi import FastAPI, UploadFile, File, HTTPException
from pydantic import BaseModel
from contextlib import asynccontextmanager
import torch
from transformers import CLIPProcessor, CLIPModel
from PIL import Image
import io

model = None
processor = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global model, processor
    print("Loading CLIP model...")
    model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32")
    processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
    model.eval()
    print("CLIP model loaded.")
    yield
    model = None
    processor = None


app = FastAPI(lifespan=lifespan)


class TextRequest(BaseModel):
    text: str


@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": model is not None}


@app.post("/embed")
async def embed(file: UploadFile = File(...)):
    if model is None or processor is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    contents = await file.read()
    try:
        image = Image.open(io.BytesIO(contents)).convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid image file")

    inputs = processor(images=image, return_tensors="pt")
    with torch.no_grad():
        features = model.get_image_features(**inputs)
        features = features / features.norm(dim=-1, keepdim=True)

    return {"embedding": features[0].tolist()}


@app.post("/embed-text")
async def embed_text(req: TextRequest):
    if model is None or processor is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Empty text")

    inputs = processor(text=[text], return_tensors="pt", padding=True, truncation=True)
    with torch.no_grad():
        features = model.get_text_features(**inputs)
        features = features / features.norm(dim=-1, keepdim=True)

    return {"embedding": features[0].tolist()}
