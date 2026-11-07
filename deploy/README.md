# deploy.yakushev.fr — Client-Side RunPod Deployer & CUDA 13.0 Health Monitor

100% static, browser-executed web interface for deploying and monitoring the **`comfy.work CUDA 13.0 with New Manager`** template (`casls01eko`) on RunPod without any backend server.

## Key Features
- **Zero-Backend Security**: Your RunPod API secret stays in your browser (`localStorage` if remembered, or `sessionStorage` for a single tab session) and communicates directly with `https://api.runpod.io/v2` via native CORS.
- **Locked Template (`casls01eko`)**:
  - Image: `jnxmx/comfy26:test`
  - Persistent Volume: `200 GB` mounted at `/workspace`
  - Container Disk: `15 GB`
  - Allowed CUDA Versions: `13.0`, `13.1`, `13.2`, `13.3`, `13.4`
  - Checkboxes for `NEW_MANAGER` (`1`/`0`) and `RESTORE_BACKUP` (`1`/`0`)
- **Strict 11-Tier GPU Priority Ranking (Best to Worst)**:
  1. `Pro 6000` (`RTX PRO 6000 Blackwell Server / Workstation / Max-Q`)
  2. `RTX 5090`
  3. `RTX 4090`
  4. `L40 / L40S`
  5. `RTX 5080`
  6. `Pro 5000` (`RTX PRO 5000 Blackwell` / `RTX 5000 Ada`)
  7. `4080 Super` (`RTX 4080 SUPER` / `RTX 4080`)
  8. `6000 Ada` (`RTX 6000 Ada Generation`)
  9. `Pro 4500 / SE` (`RTX PRO 4500 Blackwell` / `Server Edition`)
  10. `Pro 4000` (`RTX PRO 4000 Blackwell` / `RTX 4000 Ada` / `SFF Ada`)
  11. `RTX 3090 / Ti`
- **Focus Checkboxes & Price Filter**: Select which GPU tiers are in focus, filter by Community / Secure cloud and max `$/hr`, and deploy with one click via **Deploy Best Available in Focus**.
- **Live Browser Health & Log Monitor**:
  - Streams live system & container logs over Server-Sent Events (`GET /v2/pods/{id}/logs`).
  - Verifies CUDA 13.0 preflight completion (`STAGE: Checking CUDA initialization` -> `STAGE: Creating environment` / `/state` `stages.cuda.status === "done"`).
  - Automatically terminates and redeploys if a host has a broken GPU driver (`[fatal][gpu]`, `host_gpu_driver_corrupt`, `torch.cuda.is_available() returned False`) or host CPU overload (`CPU Overload Detected`).
  - Outputs ready links for ComfyUI (`:7860`), FileBrowser (`:8080`), JupyterLab (`:8888`), RunPod Console, SSH, and a one-click **Copy ComfyUI URL (:7860) for Comfy Desktop** button.

## Deploying to GitHub Pages (`deploy.yakushev.fr`)

1. Create a new GitHub repository (e.g., `deploy-yakushev-fr`) and push this folder:
   ```bash
   git init
   git add .
   git commit -m "Initial commit: deploy.yakushev.fr client-side RunPod deployer"
   git branch -M main
   git remote add origin git@github.com:<your-github-username>/<repo-name>.git
   git push -u origin main
   ```
2. In your GitHub repository, go to **Settings -> Pages**:
   - Under **Build and deployment -> Source**, select **GitHub Actions** (uses `.github/workflows/deploy.yml`) or **Deploy from a branch (`main` / `/root`)**.
   - The included `CNAME` file automatically configures the custom domain `deploy.yakushev.fr`.
3. In your DNS provider for `yakushev.fr`, add a `CNAME` record:
   - **Name / Host**: `deploy`
   - **Target / Value**: `<your-github-username>.github.io.`
4. Enable **Enforce HTTPS** in GitHub Pages settings once the DNS certificate is provisioned.
