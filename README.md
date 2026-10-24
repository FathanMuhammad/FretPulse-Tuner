<div align="center">

  <img src="tunesense_marvel_logo.png" alt="TuneSense Logo" width="180" style="border-radius: 24px; box-shadow: 0 10px 25px rgba(0,0,0,0.5);" />

  # 🎸 TUNESENSE
  ### ★ 1980s MARVEL COMIC BOOK EDITION ★
  
  **Aplikasi Tuner Gitar Presisi Tinggi dengan Estetika Visual Komik Retro Marvel Era 80-an**

  <p>
    <a href="https://github.com/FathanMuhammad/TuneSense/releases/download/latest/TuneSense-latest.apk">
      <img src="https://img.shields.io/badge/⚡_DOWNLOAD_APK-LATEST_BUILD-e22129?style=for-the-badge&logo=android&logoColor=white" alt="Download APK" />
    </a>
    <a href="https://github.com/FathanMuhammad/TuneSense/releases">
      <img src="https://img.shields.io/badge/📦_RELEASES-GITHUB-facc15?style=for-the-badge&logo=github&logoColor=black" alt="Releases" />
    </a>
  </p>

  <p>
    <a href="https://github.com/FathanMuhammad/TuneSense/actions/workflows/build-apk.yml">
      <img src="https://github.com/FathanMuhammad/TuneSense/actions/workflows/build-apk.yml/badge.svg" alt="Build Status" />
    </a>
    <img src="https://img.shields.io/badge/Platform-Android_%7C_Web-38bdf8?style=flat-square&logo=googlechrome&logoColor=white" alt="Platform" />
    <img src="https://img.shields.io/badge/Audio_Engine-McLeod_NSDF_%C2%B10.1Hz-22c55e?style=flat-square" alt="Audio Engine" />
    <img src="https://img.shields.io/badge/Creator-Fathan_Nuhi-f97316?style=flat-square" alt="Creator" />
    <img src="https://img.shields.io/badge/License-MIT-gray?style=flat-square" alt="License" />
  </p>

</div>

---

> [!TIP]
> **Otomatis Update Tiap Push Baru!**  
> Tombol **`DOWNLOAD APK`** di atas terhubung langsung ke GitHub Actions Continuous Deployment. Setiap kali ada perubahan kode yang di-push ke branch `main`, APK baru akan otomatis dikompilasi dan siap diunduh secara instan tanpa perlu menunggu rilis manual!

---

## ⚡ Sekilas tentang TuneSense

**TuneSense** adalah aplikasi tuner instrumen gitar modern yang menggabungkan presisi algoritma pemrosesan sinyal digital (*Digital Signal Processing*) dengan sentuhan desain retro buku komik Marvel era 1980-an. 

Aplikasi ini dirancang untuk musisi dan gitaris yang menginginkan akurasi nada studio, respon deteksi instan tanpa delay, serta antarmuka visual yang berkarakter, unik, dan menyenangkan.

---

## 🌟 Fitur Unggulan

### 1. 🎯 Algoritma Deteksi Nada Studio (McLeod NSDF)
- Menggunakan metode **Normalized Square Difference Function (NSDF)** dengan **Parabolic Peak Interpolation** pada buffer audio `fftSize: 4096`.
- Rentang deteksi nada dioptimalkan khusus untuk instrumen gitar (**55 Hz s/d 1100 Hz**), mencegah interferensi gemuruh sub-bass maupun desis ultrasonik.
- Akurasi super presisi hingga **±0.1 Hz** dengan indikator deviasi *cents* interaktif (-50 cents s/d +50 cents).

### 2. 🎛️ 3 Mode Tuning Fleksibel
- **🌟 AUTO MODE**: Mendeteksi secara otomatis senar gitar mana yang sedang dipetik berdasarkan kemiripan frekuensi nada terdekat.
- **🔒 LOCK / MANUAL MODE**: Mengunci target tuning pada satu senar tertentu (1st E4 s/d 6th E2) untuk memudahkan proses stem senar secara berurutan.
- **📻 CHROMATIC MODE**: Mendeteksi seluruh 12 nada tangga nada kromatik (`C, C#, D, D#, E, F, F#, G, G#, A, A#, B`) lengkap dengan pembacaan oktaf untuk tuning alternatif (*Drop D, DADGAD, Open G*, dsb.).

### 3. 🔬 Tuner Calibration & Audio Labs
- **Kalibrasi A4 Pitch**: Kustomisasi patokan nada dasar A4 dari **432 Hz s/d 448 Hz** (dilengkapi tombol preset cepat: `432 Hz`, `440 Hz standard`, `442 Hz`, `444 Hz`).
- **Noise Gate Force Field**: Slider pengatur sensitivitas ambang batas RMS mikrofon untuk menyaring kebisingan ruangan dan dengungan (*hum*).
- **Synthetic Reference Tone Generator**: Pemutar nada referensi murni (*Web Audio API Oscillator*) untuk membantu menyetem gitar menggunakan pendengaran telinga (*ear training*).

### 4. 💥 Desain Marvel Comic Era 80-an
- Titik cetak vintage (*Ben-Day Halftone Pattern*), garis tinta hitam tebal (*inked comic border*), tipografi khas komik superhero (*Bangers font*), serta dynamic gauge needle bergaya vintage voltmeter.

---

## 🎵 Matriks Frekuensi Senar Gitar Standar

| Senar | Nama Nada | Oktaf | Frekuensi Target (A4 = 440 Hz) |
| :---: | :---: | :---: | :---: |
| **1st** | **High E (E4)** | 4 | `329.63 Hz` |
| **2nd** | **B (B3)** | 3 | `246.94 Hz` |
| **3rd** | **G (G3)** | 3 | `196.00 Hz` |
| **4th** | **D (D3)** | 3 | `146.83 Hz` |
| **5th** | **A (A2)** | 2 | `110.00 Hz` |
| **6th** | **Low E (E2)** | 2 | `82.41 Hz` |

---

## 📲 Cara Download & Pasang APK di Android

1. Klik tombol [**⚡ DOWNLOAD APK LATEST BUILD**](https://github.com/FathanMuhammad/TuneSense/releases/download/latest/TuneSense-latest.apk) di bagian atas.
2. Tunggu proses pengunduhan file `TuneSense-latest.apk` selesai pada smartphone Android Anda.
3. Buka file `.apk` yang baru saja diunduh:
   - Jika muncul peringatan keamanan, pilih **Settings / Pengaturan** > aktifkan **"Allow from this source / Izinkan dari sumber ini"**.
4. Tekan **Install** dan buka **TuneSense**.
5. Berikan izin akses mikrofon saat diminta agar aplikasi dapat mendeteksi nada gitar Anda.

---

## 💻 Panduan Menjalankan Proyek (Development)

### Persyaratan Sistem
- [Node.js](https://nodejs.org/) versi 18 atau lebih baru
- NPM versi 9+
- *(Opsional untuk build native lokal)* Android Studio & JDK 21

### Langkah Instalasi
1. **Clone repositori**:
   ```bash
   git clone https://github.com/FathanMuhammad/TuneSense.git
   cd TuneSense
   ```

2. **Pasang dependensi**:
   ```bash
   npm install
   ```

3. **Jalankan local web server**:
   ```bash
   npm run dev
   ```
   Aplikasi akan terbuka di `http://localhost:3000` (atau port yang tertera).

4. **Sinkronisasi ke Android (Capacitor)**:
   ```bash
   npm run build
   npx cap sync android
   ```

---

## 🛠️ Tech Stack & Library

- **Core Framework**: [React 19](https://react.dev/) + [Vite 6](https://vitejs.dev/)
- **Mobile Engine**: [@capacitor/core & @capacitor/android 7](https://capacitorjs.com/)
- **Audio Processing**: Web Audio API (`AudioContext`, `AnalyserNode`, `Float32Array`, `OscillatorNode`)
- **Styling**: [Tailwind CSS 3](https://tailwindcss.com/) dengan kustomisasi Google Fonts (`Bangers`, `Permanent Marker`, `Space Grotesk`)
- **Icons**: [Lucide React](https://lucide.dev/)
- **CI/CD Pipeline**: GitHub Actions (`build-apk.yml`) otomatis merilis APK ke GitHub Releases pada setiap push.

---

## 👤 Kredit & Pembuat

Aplikasi ini dikembangkan dan dirancang oleh:

<div align="center">
  <p>
    <strong>Muhammad Fathan Nuhi</strong><br />
    <em>Creator & Developer of TuneSense</em>
  </p>
  <a href="https://github.com/FathanMuhammad">
    <img src="https://img.shields.io/badge/GitHub-FathanMuhammad-181717?style=for-the-badge&logo=github" alt="GitHub Profile" />
  </a>
</div>

---

<div align="center">
  <sub>TuneSense © 2026. Made with ❤️ for guitarists and comic book enthusiasts worldwide.</sub>
</div>
