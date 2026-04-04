import json
import os

# 백엔드 스크립트 위치 기준: marketflow/backend/services -> marketflow/prompts
PROMPTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'prompts'))
REGISTRY_PATH = os.path.join(PROMPTS_DIR, '_registry.json')

def load_prompt_text(filepath: str) -> str:
    """YAML Frontmatter를 제거하고 순수 마크다운 텍스트만 파싱"""
    if not os.path.exists(filepath):
        return ""
    
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # YAML header 제거 (--- 로 시작하는 블록 제거)
    if content.startswith('---'):
        parts = content.split('---', 2)
        if len(parts) >= 3:
            return parts[2].strip()
    
    return content.strip()

class PromptManager:
    @staticmethod
    def _get_registry() -> dict:
        if not os.path.exists(REGISTRY_PATH):
            return {}
        with open(REGISTRY_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)

    @classmethod
    def get_auto_prompt(cls, page_name: str) -> str:
        """주어진 페이지의 현재 active인 auto 프롬프트를 반환"""
        registry = cls._get_registry()
        try:
            active_rel_path = registry['pages'][page_name]['auto']['active']
            # JSON 경로는 항상 '/' 이므로 OS 호환성 맞춤
            full_path = os.path.join(PROMPTS_DIR, active_rel_path.replace('/', os.sep))
            return load_prompt_text(full_path)
        except KeyError:
            return ""

    @classmethod
    def get_user_reqs(cls, page_name: str) -> list[str]:
        """주어진 페이지의 현재 active인 user_req 프롬프트 내용 목록 반환"""
        registry = cls._get_registry()
        req_texts = []
        try:
            active_paths = registry['pages'][page_name]['user_req'].get('active', [])
            for rel_path in active_paths:
                full_path = os.path.join(PROMPTS_DIR, rel_path.replace('/', os.sep))
                text = load_prompt_text(full_path)
                if text:
                    req_texts.append(text)
        except KeyError:
            pass
        return req_texts

    @classmethod
    def get_auto_prompt_meta(cls, page_name: str) -> dict:
        """현재 활성화된 프롬프트의 메타데이터(버전, 키, 폴백 여부 등) 반환"""
        registry = cls._get_registry()
        try:
            active_rel_path = registry['pages'][page_name]['auto']['active']
            if not active_rel_path:
                raise ValueError("Active path is empty")
            filename = os.path.basename(active_rel_path)
            # v1.0.0_risk_analysis.md -> version=v1.0.0, key=risk_analysis
            version = "unknown"
            key = page_name
            if '_' in filename:
                parts = filename.split('_', 1)
                version = parts[0]
                key = parts[1].replace('.md', '')
            
            return {
                "version": version,
                "key": key,
                "source": "registry",
                "fallback_used": False
            }
        except Exception:
            return {
                "version": "default_fallback",
                "key": "fallback",
                "source": "fallback",
                "fallback_used": True
            }

    @classmethod
    def assemble_full_prompt(cls, page_name: str) -> str:
        """Auto 프롬프트와 현재 Active 상태인 유저 요청을 결합하여 1개의 최종 프롬프트로 생성"""
        auto_text = cls.get_auto_prompt(page_name)
        user_reqs = cls.get_user_reqs(page_name)
        
        parts = [auto_text]
        if user_reqs:
            parts.append("\n\n===[ 구독자 특별 요청 사항 (반드시 반영할 것) ]===")
            for i, req in enumerate(user_reqs, 1):
                parts.append(f"\n요청사항 {i}:\n{req}")
                
        return "".join(parts).strip()
