class BaseConnector:
    def connect(self):
        raise NotImplementedError

    def query(self, query, params=None):
        raise NotImplementedError

    def close(self):
        raise NotImplementedError
