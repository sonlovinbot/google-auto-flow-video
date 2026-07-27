const translations = {
  vi: {
    subtitle: "Trình quản lý tác vụ tự động cho Flow AI (Veo)",
    badge_classic: "EXTENSION",
    classic_title: "Phiên bản 8.4.2 (Extension)",
    classic_desc:
      "Mở giao diện tạo video trực tiếp trong Chrome.",
  },
  en: {
    subtitle: "Automated task manager for Flow AI (Veo)",
    badge_classic: "EXTENSION",
    classic_title: "Version 8.4.2 (Extension)",
    classic_desc:
      "Open the video creation workspace directly in Chrome.",
  },
};

function setGatewayLanguage(language) {
  const copy = translations[language] || translations.en;
  document.querySelectorAll("[data-lang-key]").forEach((element) => {
    const key = element.getAttribute("data-lang-key");
    if (copy[key]) element.textContent = copy[key];
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const selector = document.getElementById("languageSelector");
  chrome.storage.local.get(["language"], (stored) => {
    const language = translations[stored.language] ? stored.language : "en";
    selector.value = language;
    setGatewayLanguage(language);
  });
  selector.addEventListener("change", (event) => {
    setGatewayLanguage(event.target.value);
    chrome.storage.local.set({ language: event.target.value });
  });
  document.getElementById("btn-classic").addEventListener("click", () => {
    window.location.href = "sidepanel.html";
  });
});
