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

            # Explicitly map db_type to class names to handle special cases
            class_name_map = {
                'mysql': 'MySQLConnector',  # Map 'mysql' db_type to 'MySQLConnector' class
                # Add more mappings as needed for other databases
            }
            class_name = class_name_map.get(db_type)

            if not class_name:
                raise ValueError(f"No connector class found for db_type '{db_type}'")

            connector_class = getattr(module, class_name)
            if not issubclass(connector_class, BaseConnector):
                raise TypeError(f"{class_name} must be a subclass of BaseConnector")
            # Instantiate the connector with the provided configuration
            return connector_class(config)
        except (ImportError, AttributeError, ValueError, TypeError) as e:
            raise ImportError(f"Could not load database connector for {db_type}: {e}")

    def query(self, query, params=None):
        return self.connector.query(query, params)

    def close(self):
        self.connector.close()
