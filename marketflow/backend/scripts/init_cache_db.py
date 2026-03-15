from backend.services.cache_store import CacheStore, resolve_db_path


def main() -> None:
    store = CacheStore()
    store.init_schema()
    store.close()
    print(f"cache.db schema initialized: {resolve_db_path()}")


if __name__ == "__main__":
    main()
