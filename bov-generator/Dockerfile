FROM python:3.11-slim

# Install LibreOffice (for formula recalculation) + build tools (for AF_UNIX shim if needed)
RUN apt-get update && apt-get install -y --no-install-recommends \
        libreoffice-calc \
        gcc \
        && rm -rf /var/lib/apt/lists/*

# Set headless display for LibreOffice
ENV SAL_USE_VCLPLUGIN=svp
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8080

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "2"]
