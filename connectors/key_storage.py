class KeyStorage:
    keys = {}

    @classmethod
    def set_key(cls, key_name, key_value):
        cls.keys[key_name] = key_value

    @classmethod
    def get_key(cls, key_name):
        return cls.keys.get(key_name)
