t = open('frontend/index.html', encoding='utf-8', errors='replace').read()
print('recon_user_secure' in t)
print('localStorage.getItem("recon_user_secure")' in t)
