import importlib
from db.connectors.base_connector import BaseConnector

class DatabaseManager:
    def __init__(self, db_type, config):
        self.config = config
        self.connector = self._load_connector(db_type, config)

    def _load_connector(self, db_type, config):
        try:
            # Dynamically import the corresponding connector module
            module = importlib.import_module(f'db.connectors.{db_type}_connector')
            # Get the connector class (assumes the class name matches the module name but with CamelCase)
            class_name = ''.join(word.title() for word in db_type.split('_')) + 'Connector'
            connector_class = getattr(module, class_name)
            if not issubclass(connector_class, BaseConnector):
                raise TypeError(f"{class_name} must be a subclass of BaseConnector")
            # Instantiate the connector with the provided configuration
            return connector_class(config)
        except (ImportError, AttributeError) as e:
            raise ImportError(f"Could not load database connector for {db_type}: {e}")

    def query(self, query, params=None):
        return self.connector.query(query, params)

    def close(self):
        self.connector.close()
