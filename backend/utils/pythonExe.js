const { execSync } = require('child_process');

// Uu tien 'py' (Python Launcher that) truoc 'python'/'python3' - Windows co san 1 "app execution
// alias" python.exe gia tro toi Microsoft Store, Get-Command/where van thay no ton tai nen phai
// tu chay --version de xac nhan la Python that (xem buildAgentSetupScript Get-RealPythonExe).
//
// Dung chung boi backend/routes/system.js (pipeline "Cap nhat") VA backend/engine/runner.js (chay
// node Python that) - truoc day 2 noi tu resolve rieng (system.js uu tien 'py', runner.js goi cung
// 'python'), tren may co nhieu ban Python song song 2 lenh nay co the tro toi 2 moi truong khac
// nhau: "Cap nhat" nang cap dung moi truong cua 'py', nhung luc chay node that lai dung moi truong
// cua 'python' - yt-dlp van cu du da bam "Cap nhat" thanh cong (xem docs/issues tuong ung).
function findPythonExe(cwd) {
  for (const exe of ['py', 'python', 'python3']) {
    try {
      const out = execSync(`${exe} --version 2>&1`, { cwd, encoding: 'utf8', windowsHide: true });
      if (/Python \d/.test(out)) return exe;
    } catch {
      // exe nay khong that hoac khong ton tai - thu exe tiep theo
    }
  }
  return null;
}

module.exports = { findPythonExe };
